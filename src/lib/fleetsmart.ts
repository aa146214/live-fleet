import { SHUTTLE_SEARCH_RADIUS_KM } from "@/config/vehicle-assignments";
import { getAssignments, getRoutes, normaliseVrn, type Assignment } from "./config-store";
import { distanceMetres, estimateNextDestination } from "./destination";
import { attachRoads, nearestRoad, streetNear } from "./road-paths";
import { locateOnLoop, loopIfReady, loopStopsFor, nextStop, roadAhead } from "./route-loops";
import { STUDIO_LOCATION, defaultStops, getRoute, placesFor, type ShuttleRoute } from "./routes";
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

interface Resource extends ResourceIdentifier {
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: ResourceIdentifier | null }>;
}

interface JsonApiDocument {
  data: Resource[];
  included?: Resource[];
}

// The API accepts the key on its own; the client ID header is sent only when configured.
export function hasFleetSmartCredentials(): boolean {
  return Boolean(process.env.FLEETSMART_API_KEY);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(page: number): Promise<JsonApiDocument> {
  const params = new URLSearchParams({
    include: "vehicle,vehicle_location",
    "page[size]": String(PAGE_SIZE),
    "page[number]": String(page),
  });
  const headers: Record<string, string> = {
    "X-API-KEY": process.env.FLEETSMART_API_KEY ?? "",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
  if (process.env.FLEETSMART_CLIENT_ID) headers["X-CLIENT-ID"] = process.env.FLEETSMART_CLIENT_ID;

  const response = await fetch(`${BASE_URL}/live_views?${params}`, { headers, cache: "no-store" });
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

/** Minibuses near the studio that aren't shuttles yet are shown too, without a route. */
function isNearbyMinibus(icon: string, lat: number, lng: number): boolean {
  return (
    icon.includes("bus") &&
    distanceMetres(STUDIO_LOCATION, { lat, lng }) <= SHUTTLE_SEARCH_RADIUS_KM * 1000
  );
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
    // Shuttles are always shown; so are the other minibuses near the studio, without a route.
    if (!assignment && !isNearbyMinibus(asString(vehicle.attributes.icon), lat, lng)) continue;
    const code = assignment?.code ?? normaliseVrn(registration);
    const routeId = assignment?.routeId ?? null;
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
      stops: assignment?.stops,
      nextDestination: estimateNextDestination({ lat, lng }, getRoute(routes, routeId), heading, status),
    });
  }

  return vehicles.sort(
    (a, b) => (a.routeId ?? 99) - (b.routeId ?? 99) || a.code.localeCompare(b.code),
  );
}

async function fetchAllPages(): Promise<JsonApiDocument[]> {
  const documents: JsonApiDocument[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(RATE_LIMIT_GAP_MS);
    const doc = await fetchPage(page);
    documents.push(doc);
    if (doc.data.length < PAGE_SIZE) break;
  }
  return documents;
}

async function fetchLiveVehicles(routes: ShuttleRoute[]): Promise<Vehicle[]> {
  const documents = await fetchAllPages();
  const vehicles = toVehicles(documents, await getAssignments(), routes);
  await attachRoads(vehicles, ROAD_LOOKUP_WAIT_MS);
  applyRouterDetails(vehicles, routes);
  return vehicles;
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
function applyRouterDetails(vehicles: Vehicle[], routes: ShuttleRoute[]): void {
  const places = placesFor(routes);
  for (const vehicle of vehicles) {
    const route = getRoute(routes, vehicle.routeId);
    const stopIds = vehicle.stops ?? (route ? defaultStops(route) : undefined);
    const stops = stopIds && loopStopsFor(stopIds, places, routes);
    const loop = stops ? loopIfReady(stops) : undefined;
    const here = loop ? locateOnLoop(loop, vehicle, vehicle.heading) : null;
    const moving = vehicle.status === "moving";

    // A parked minibus has no direction of travel, so keep the guess (it leaves for the far end).
    if (loop && here && moving) vehicle.nextDestination = nextStop(loop, here.along);
    if (vehicle.address === NO_ADDRESS) {
      const street = loop && here ? streetAt(loop.streets, here.along) : streetNear(vehicle);
      if (street) vehicle.address = street;
    }

    if (!moving) continue;
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

    if (loop && onRoute) {
      vehicle.ahead = roadAhead(loop, onRoute.along, (vehicle.speedMph ?? 0) * MPH_TO_MPS);
    }
  }
}

/** How long a refresh waits for new road lookups before answering without them. */
const ROAD_LOOKUP_WAIT_MS = 3000;

let cached: { at: number; snapshot: FleetSnapshot } | null = null;
let inFlight: Promise<FleetSnapshot> | null = null;

/** Live snapshot, shared across requests so the API rate limit is respected. */
export async function getLiveSnapshot(): Promise<FleetSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.snapshot;
  if (inFlight) return inFlight;

  inFlight = getRoutes()
    .then(async (routes) => ({ routes, vehicles: await fetchLiveVehicles(routes) }))
    .then(({ routes, vehicles }) => {
      const snapshot: FleetSnapshot = { mode: "live", routes, vehicles, fetchedAt: new Date().toISOString() };
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
