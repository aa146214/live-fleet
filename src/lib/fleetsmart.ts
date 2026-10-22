import { getAssignments, getRoutes, normaliseVrn, type Assignment } from "./config-store";
import { distanceMetres, estimateNextDestination, type StopPoint } from "./destination";
import { attachRoads, nearestRoad, streetNear, type PreviousReport } from "./road-paths";
import { locateOnLoop, loopIfReady, loopStopsFor, nextStop, PREDICT_BETWEEN_REPORTS, roadAhead } from "./route-loops";
import {
  BUILT_IN_PLACES,
  STUDIO_LOCATION,
  getRoute,
  pinPlacesFor,
  placeKindOf,
  stopSequence,
  tidyPlaceName,
  type PinPlace,
  type Place,
  type PlaceId,
  type ShuttleRoute,
} from "./routes";
import { streetAt } from "./polyline-simulation";
import type { FleetSnapshot, Vehicle, VehicleStatus } from "./types";

// API guide: https://apiguide.fleetsmartlive.com/
/** Shown when FleetSmart gives no address. */
const NO_ADDRESS = "Address unavailable";
const BASE_URL = process.env.FLEETSMART_BASE_URL ?? "https://www.fleetsmartlive.com/api";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
// FleetSmart allows one request per second per client.
const RATE_LIMIT_GAP_MS = 1100;
const CACHE_TTL_MS = 10_000;

interface ResourceIdentifier {
  type: string;
  id: string;
}

export interface Resource extends ResourceIdentifier {
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: ResourceIdentifier | null }>;
}

export interface JsonApiDocument {
  data: Resource[];
  included?: Resource[];
}

// The API accepts the key on its own; the client ID header is sent only when configured.
export function hasFleetSmartCredentials(): boolean {
  return Boolean(process.env.FLEETSMART_API_KEY);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let fleetSmartSlot = Promise.resolve();
/**
 * Waits for this server's next turn with FleetSmart, which allows one request a second.
 * Every request goes through here, so lookups running side by side don't get refused.
 */
function fleetSmartTurn(): Promise<void> {
  const mine = fleetSmartSlot;
  fleetSmartSlot = mine.then(() => sleep(RATE_LIMIT_GAP_MS));
  return mine;
}

async function fetchPage(page: number): Promise<JsonApiDocument> {
  return fleetSmartGet(
    "/live_views",
    new URLSearchParams({
      include: "vehicle,vehicle_location",
      "page[size]": String(PAGE_SIZE),
      "page[number]": String(page),
    }),
  );
}

/** One request to the FleetSmart API, in turn (it allows one per second per client). */
export async function fleetSmartGet(path: string, params: URLSearchParams, timeoutMs?: number): Promise<JsonApiDocument> {
  await fleetSmartTurn();
  const headers: Record<string, string> = {
    "X-API-KEY": process.env.FLEETSMART_API_KEY ?? "",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
  if (process.env.FLEETSMART_CLIENT_ID) headers["X-CLIENT-ID"] = process.env.FLEETSMART_CLIENT_ID;

  const response = await fetch(`${BASE_URL}${path}?${params}`, {
    headers,
    cache: "no-store",
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!response.ok) {
    throw new Error(`FleetSmart responded ${response.status} ${response.statusText}`);
  }
  // The Date header is truncated to whole seconds, so assume the middle of that second.
  const serverDate = Date.parse(response.headers.get("date") ?? "");
  if (Number.isFinite(serverDate)) clockAheadMs = Date.now() - (serverDate + 500);
  return response.json();
}

/** How far this server's clock is ahead of FleetSmart's (to about a second). */
let clockAheadMs = 0;

/**
 * The current time by FleetSmart's clock. Sent with each response so browsers can
 * line report times up with their own clocks, which may be off by many seconds.
 */
export function fleetSmartNow(): string {
  return new Date(Date.now() - clockAheadMs).toISOString();
}

const asString = (value: unknown) => (typeof value === "string" ? value : "");
const asNumber = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

// Observed live_views statuses: "moving", "idle", "start" (ignition on) and "stop".
function toStatus(value: string): VehicleStatus {
  if (value === "moving") return "moving";
  if (value === "idle" || value === "idling" || value === "start") return "idling";
  if (value === "stop" || value === "stopped") return "stopped";
  return "unknown";
}

function toVehicles(
  documents: JsonApiDocument[],
  assignments: Map<string, Assignment>,
  routes: ShuttleRoute[],
): Vehicle[] {
  const included = new Map<string, Resource>();
  for (const doc of documents) {
    for (const resource of doc.included ?? []) {
      included.set(`${resource.type}:${resource.id}`, resource);
    }
  }
  const lookup = (ref?: ResourceIdentifier | null) =>
    ref ? included.get(`${ref.type}:${ref.id}`) : undefined;

  const vehicles: Vehicle[] = [];
  for (const liveView of documents.flatMap((doc) => doc.data)) {
    const vehicle = lookup(liveView.relationships?.vehicle?.data);
    const location = lookup(liveView.relationships?.vehicle_location?.data);
    const lat = asNumber(location?.attributes.latitude);
    const lng = asNumber(location?.attributes.longitude);
    if (!vehicle || lat === null || lng === null) continue;

    const registration = asString(vehicle.attributes.vrn);
    const assignment = assignments.get(normaliseVrn(registration));
    // Only the vehicles set up as shuttles (in the admin) are shown.
    if (!assignment) continue;
    const code = assignment?.code ?? normaliseVrn(registration);
    // A shuttle whose route has gone is shown without one.
    const route = getRoute(routes, assignment.routeId);
    const routeId = route?.id ?? null;
    const status = toStatus(asString(liveView.attributes.status));
    // Moving: the heading is the direction of travel. Parked: FleetSmart keeps the last
    // heading for some vehicles but reports 0 for most, so treat a parked 0 as unknown.
    const reported = asNumber(location?.attributes.heading);
    const heading = status === "moving" || reported !== 0 ? reported : null;
    const address = [asString(location?.attributes.address), asString(location?.attributes.postcode)]
      .filter(Boolean)
      .join(", ");

    vehicles.push({
      id: vehicle.id,
      code,
      routeId,
      registration: registration || "Unknown",
      lat,
      lng,
      heading,
      speedMph: asNumber(location?.attributes.speed),
      status,
      address: address || NO_ADDRESS,
      // When the tracker took this position (the live view's updated_at is when it reached FleetSmart).
      updatedAt:
        asString(location?.attributes.date_time) || asString(liveView.attributes.updated_at) || null,
      stops: route?.stops,
      // A guess for now; guessDestinations (once the places are known) and the road then improve it.
      nextDestination: "Not on a shuttle route",
    });
  }

  return vehicles.sort(
    (a, b) => (a.routeId ?? 99) - (b.routeId ?? 99) || a.code.localeCompare(b.code),
  );
}

async function fetchAllPages(): Promise<JsonApiDocument[]> {
  const documents: JsonApiDocument[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const doc = await fetchPage(page);
    documents.push(doc);
    if (doc.data.length < PAGE_SIZE) break;
  }
  return documents;
}

/** FleetSmart's vehicle id for each registration seen, so later requests can ask for just the shuttles. */
const vehicleIds = new Map<string, string>();

function rememberVehicleIds(documents: JsonApiDocument[]): void {
  for (const doc of documents) {
    for (const resource of doc.included ?? []) {
      const vrn = resource.type === "vehicles" ? asString(resource.attributes.vrn) : "";
      if (vrn) vehicleIds.set(normaliseVrn(vrn), resource.id);
    }
  }
}

/**
 * The live views of the shuttles. Asking for just them is about three times faster
 * than for the whole fleet (0.6 s against 2 s), but needs their vehicle ids, which
 * FleetSmart gives only with the whole fleet (it can't filter by registration). So a
 * freshly started server fetches the whole fleet once, at the same time as reading the
 * shuttles from the database, and asks for just the shuttles from then on.
 */
async function fetchShuttleViews(assignments: Promise<Map<string, Assignment>>): Promise<JsonApiDocument[]> {
  if (vehicleIds.size > 0) {
    const ids = [...(await assignments).keys()].map((vrn) => vehicleIds.get(vrn));
    if (ids.length === 0) return [];
    if (ids.every(Boolean)) {
      const params = new URLSearchParams({
        include: "vehicle,vehicle_location",
        "filter[vehicle_id]": ids.join(","),
        "page[size]": String(PAGE_SIZE),
      });
      return [await fleetSmartGet("/live_views", params)];
    }
  }
  // A new shuttle (or a new server): fetch the whole fleet to learn the ids.
  const documents = await fetchAllPages();
  rememberVehicleIds(documents);
  return documents;
}

/**
 * How long to wait for FleetSmart's history of one vehicle. Two reports for one vehicle take
 * about two seconds, but a request that covers several vehicles never came back, so ask for
 * them one at a time.
 */
const HISTORY_TIMEOUT_MS = 8000;

/** The report before `report`, from the vehicle's history in FleetSmart. */
const previousReportOf: PreviousReport = async (vehicle, report) => {
  const doc = await fleetSmartGet(
    "/vehicle_locations",
    new URLSearchParams({ "filter[vehicle_id]": vehicle.id, "page[size]": "2", sort: "-id" }),
    HISTORY_TIMEOUT_MS,
  );
  const before = doc.data
    .map((row) => row.attributes)
    .filter((a) => asString(a.date_time) && Date.parse(asString(a.date_time)) < Date.parse(report.at))
    .sort((a, b) => Date.parse(asString(b.date_time)) - Date.parse(asString(a.date_time)))[0];
  const lat = asNumber(before?.latitude);
  const lng = asNumber(before?.longitude);
  if (!before || lat === null || lng === null) return null;
  const speedMph = asNumber(before.speed);
  const reported = asNumber(before.heading);
  return {
    lat,
    lng,
    at: asString(before.date_time),
    speedMph,
    // As for the live report: a parked tracker's heading of 0 means unknown.
    heading: (speedMph ?? 0) > 0 || reported !== 0 ? reported : null,
  };
};

/** Reads the routes, the shuttles and their live positions side by side, rather than one after another. */
async function fetchLiveVehicles(): Promise<{ routes: ShuttleRoute[]; places: PinPlace[]; vehicles: Vehicle[] }> {
  const assignmentsRead = getAssignments();
  const views = fetchShuttleViews(assignmentsRead);
  // Started after the live views so it takes FleetSmart's next turn, not the first.
  const fleetPlaces = listFleetPlaces();
  const [routes, assignments, documents] = await Promise.all([getRoutes(), assignmentsRead, views]);

  const vehicles = toVehicles(documents, assignments, routes);
  await attachRoads(vehicles, ROAD_LOOKUP_WAIT_MS, previousReportOf);
  const places = withFleetPlaces(await fleetPlaces);
  for (const vehicle of vehicles) {
    if (vehicle.stops) vehicle.routeText = stopSequence(places, vehicle.stops);
  }
  guessDestinations(vehicles, places);
  applyRouterDetails(vehicles, places);
  return { routes, places: pinPlacesFor(routes, places), vehicles };
}



/** A place set up in the FleetSmart account (its Points of Interest). */
export interface FleetPlace {
  /** `poi-` and FleetSmart's id. */
  id: PlaceId;
  /** The name, tidied (FleetSmart often has capitals). */
  name: string;
  lat: number;
  lng: number;
}

let placesCache: { at: number; places: FleetPlace[] } | undefined;
let placesLoading: Promise<FleetPlace[]> | undefined;
const PLACES_CACHE_MS = 10 * 60_000;
/** Places in the FleetSmart account that are never offered as stops (Warner Bros. doesn't want them listed). */
const HIDDEN_PLACE_NAMES = [/pinewood/i];

/**
 * The places in the FleetSmart account, or none if it can't be reached. Refreshed every
 * ten minutes; while a refresh is under way the previous list is returned straight away.
 */
export async function listFleetPlaces(): Promise<FleetPlace[]> {
  if (!hasFleetSmartCredentials()) return [];
  if (placesCache && Date.now() - placesCache.at < PLACES_CACHE_MS) return placesCache.places;
  placesLoading ??= loadFleetPlaces().finally(() => {
    placesLoading = undefined;
  });
  return placesCache ? placesCache.places : placesLoading;
}

async function loadFleetPlaces(): Promise<FleetPlace[]> {
  try {
    const places: FleetPlace[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const doc = await fleetSmartGet(
        "/pois",
        new URLSearchParams({ "page[size]": String(PAGE_SIZE), "page[number]": String(page) }),
      );
      for (const poi of doc.data) {
        const lat = asNumber(poi.attributes.lat);
        const lng = asNumber(poi.attributes.lng);
        const name = tidyPlaceName(asString(poi.attributes.name));
        if (HIDDEN_PLACE_NAMES.some((hidden) => hidden.test(name))) continue;
        if (lat !== null && lng !== null && name) places.push({ id: `poi-${poi.id}` as PlaceId, name, lat, lng });
      }
      if (doc.data.length < PAGE_SIZE) break;
    }
    placesCache = { at: Date.now(), places };
    return places;
  } catch (error) {
    console.error("[fleetsmart] places:", error instanceof Error ? error.message : error);
    return placesCache?.places ?? [];
  }
}

/** Every place a stop can be: the built-in ones, and those set up in the FleetSmart account. */
export async function knownPlaces(): Promise<Place[]> {
  return withFleetPlaces(await listFleetPlaces());
}

function withFleetPlaces(fleetPlaces: FleetPlace[]): Place[] {
  return [
    ...BUILT_IN_PLACES,
    ...fleetPlaces.map(({ id, name, lat, lng }): Place => ({ id, name, lat, lng, kind: placeKindOf(name) })),
  ];
}

/** Each minibus's likely next stop, from the way it is heading, until the road through its stops is known. */
function guessDestinations(vehicles: Vehicle[], places: Place[]): void {
  for (const vehicle of vehicles) {
    const points = (vehicle.stops ?? []).flatMap((id): StopPoint[] => {
      const place = places.find((candidate) => candidate.id === id);
      return place ? [{ name: place.name, location: { lat: place.lat, lng: place.lng } }] : [];
    });
    vehicle.nextDestination = estimateNextDestination(vehicle, points, vehicle.heading, vehicle.status);
  }
}

/** A vehicle in the FleetSmart account, shuttle or not (the admin picks the shuttles from these). */
export interface FleetVehicle {
  /** Registration as FleetSmart shows it. */
  registration: string;
  /** Registration without spaces, upper case (how assignments are keyed). */
  vrn: string;
  isMinibus: boolean;
  /** Distance from the studio, in kilometres. */
  distanceKm: number;
  address: string;
}

let fleetCache: { at: number; vehicles: FleetVehicle[] } | undefined;
const FLEET_LIST_CACHE_MS = 60_000;

/** Every vehicle in the FleetSmart account, nearest the studio first. Throws if FleetSmart can't be reached. */
export async function listFleetVehicles(): Promise<FleetVehicle[]> {
  if (fleetCache && Date.now() - fleetCache.at < FLEET_LIST_CACHE_MS) return fleetCache.vehicles;

  const documents = await fetchAllPages();
  const included = new Map<string, Resource>();
  for (const doc of documents) for (const resource of doc.included ?? []) included.set(`${resource.type}:${resource.id}`, resource);
  const lookup = (ref?: ResourceIdentifier | null) => (ref ? included.get(`${ref.type}:${ref.id}`) : undefined);

  const vehicles: FleetVehicle[] = [];
  for (const liveView of documents.flatMap((doc) => doc.data)) {
    const vehicle = lookup(liveView.relationships?.vehicle?.data);
    const location = lookup(liveView.relationships?.vehicle_location?.data);
    const registration = asString(vehicle?.attributes.vrn);
    const lat = asNumber(location?.attributes.latitude);
    const lng = asNumber(location?.attributes.longitude);
    if (!vehicle || !registration || lat === null || lng === null) continue;
    vehicles.push({
      registration,
      vrn: normaliseVrn(registration),
      isMinibus: asString(vehicle.attributes.icon).includes("bus"),
      distanceKm: distanceMetres(STUDIO_LOCATION, { lat, lng }) / 1000,
      address: asString(location?.attributes.address),
    });
  }
  vehicles.sort((a, b) => a.distanceKm - b.distanceKm);
  fleetCache = { at: Date.now(), vehicles };
  return vehicles;
}

/** A moving minibus within this of a road is drawn on it. */
const SNAP_TO_ROAD_M = 60;
/** A stopped one is only moved onto a road this close, since it may really be parked off the road. */
const SNAP_PARKED_TO_ROAD_M = 15;
const MPH_TO_MPS = 0.44704;

/**
 * Uses the router to improve what FleetSmart gives us. A moving minibus is put on the
 * road if it is within SNAP_TO_ROAD_M of one (GPS is rarely exact, and a parked one
 * really can be off the road). Where its route is known it also gets the road ahead,
 * its next stop from the way it is going, and, if FleetSmart gave no address, its
 * street. The router can take a few seconds the first time, so until its answers are
 * in, the heading-based guess and "Address unavailable" stand; the next snapshot has
 * the better answer.
 */
function applyRouterDetails(vehicles: Vehicle[], places: Place[]): void {
  for (const vehicle of vehicles) {
    const stops = vehicle.stops && loopStopsFor(vehicle.stops, places);
    const loop = stops ? loopIfReady(stops) : undefined;
    const here = loop ? locateOnLoop(loop, vehicle, vehicle.heading) : null;
    const moving = vehicle.status === "moving";

    // A parked minibus has no direction of travel, so keep the guess (it leaves for the far end).
    if (loop && here && moving) vehicle.nextDestination = nextStop(loop, here.along);
    if (vehicle.address === NO_ADDRESS) {
      const street = loop && here ? streetAt(loop.streets, here.along) : streetNear(vehicle);
      if (street) vehicle.address = street;
    }

    if (!moving) {
      // Parked: onto the nearest road if one is right beside it, so it isn't drawn in a building.
      const near = nearestRoad(vehicle)?.point;
      if (near && distanceMetres(near, vehicle) <= SNAP_PARKED_TO_ROAD_M) {
        vehicle.lat = near.lat;
        vehicle.lng = near.lng;
      }
      continue;
    }
    const roadEnd = vehicle.road?.points[vehicle.road.points.length - 1];
    const onRoute = here && here.distance <= SNAP_TO_ROAD_M ? here : null;
    const snapped =
      roadEnd && distanceMetres(roadEnd, vehicle) <= SNAP_TO_ROAD_M
        ? roadEnd
        : (onRoute?.point ?? (vehicle.road ? null : nearestRoad(vehicle)?.point ?? null));
    if (snapped && distanceMetres(snapped, vehicle) <= SNAP_TO_ROAD_M) {
      vehicle.lat = snapped.lat;
      vehicle.lng = snapped.lng;
    }

    if (PREDICT_BETWEEN_REPORTS && loop && onRoute) {
      vehicle.ahead = roadAhead(loop, onRoute.along, (vehicle.speedMph ?? 0) * MPH_TO_MPS);
    }
  }
}

/** How long a refresh waits for new road lookups before answering without them. */
const ROAD_LOOKUP_WAIT_MS = 5000;

let cached: { at: number; snapshot: FleetSnapshot } | null = null;
let inFlight: Promise<FleetSnapshot> | null = null;

/** Live snapshot, shared across requests so the API rate limit is respected. */
export async function getLiveSnapshot(): Promise<FleetSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.snapshot;
  if (inFlight) return inFlight;

  inFlight = fetchLiveVehicles()
    .then(({ routes, places, vehicles }) => {
      const snapshot: FleetSnapshot = { mode: "live", routes, places, vehicles, fetchedAt: new Date().toISOString() };
      cached = { at: Date.now(), snapshot };
      return snapshot;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "FleetSmart request failed";
      console.error("[fleetsmart]", message);
      if (cached) return { ...cached.snapshot, error: message };
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
