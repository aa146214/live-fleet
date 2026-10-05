import { SHUTTLE_SEARCH_RADIUS_KM, VEHICLE_ASSIGNMENTS } from "@/config/vehicle-assignments";
import { distanceMetres, estimateNextDestination } from "./destination";
import { countVisits, routeFromEvidence, type TrackPoint } from "./route-detection";
import { STUDIO_LOCATION } from "./routes";
import type { FleetSnapshot, RouteId, Vehicle, VehicleStatus } from "./types";

// API guide: https://apiguide.fleetsmartlive.com/
const BASE_URL = process.env.FLEETSMART_BASE_URL ?? "https://www.fleetsmartlive.com/api";
const LIVE_PAGE_SIZE = 100;
const LIVE_MAX_PAGES = 5;
const CACHE_TTL_MS = 10_000;
// FleetSmart allows one request per second per client; every request goes through `throttle`.
const RATE_LIMIT_GAP_MS = 1100;

/** Route detection reads this much trip history (3 days covers a weekend gap). */
const DETECTION_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const DETECTION_REFRESH_MS = 60 * 60 * 1000;
const DETECTION_RETRY_MS = 10 * 60 * 1000;
/** Minibuses this close to the studio are checked for shuttle loops. */
const DETECTION_RADIUS_KM = 30;
const HISTORY_PAGE_SIZE = 1000;
const HISTORY_MAX_PAGES = 10;

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

let nextRequestAt = 0;
/** Waits for the next free slot so live polling and detection share the rate limit. */
async function throttle() {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + RATE_LIMIT_GAP_MS;
  if (slot > now) await sleep(slot - now);
}

async function fleetSmartGet(path: string, params: Record<string, string>): Promise<JsonApiDocument> {
  const headers: Record<string, string> = {
    "X-API-KEY": process.env.FLEETSMART_API_KEY ?? "",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
  if (process.env.FLEETSMART_CLIENT_ID) headers["X-CLIENT-ID"] = process.env.FLEETSMART_CLIENT_ID;

  await throttle();
  const response = await fetch(`${BASE_URL}/${path}?${new URLSearchParams(params)}`, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`FleetSmart responded ${response.status} ${response.statusText}`);
  }
  const body = await response.text();
  return body ? JSON.parse(body) : { data: [] };
}

const asString = (value: unknown) => (typeof value === "string" ? value : "");
const asNumber = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const normaliseVrn = (vrn: string) => vrn.replace(/\s+/g, "").toUpperCase();

const ASSIGNMENTS_BY_VRN = new Map(
  Object.entries(VEHICLE_ASSIGNMENTS).map(([vrn, assignment]) => [normaliseVrn(vrn), assignment]),
);

// Observed live_views statuses: "moving", "idle", "start" (ignition on) and "stop".
function toStatus(value: string): VehicleStatus {
  if (value === "moving") return "moving";
  if (value === "idle" || value === "idling" || value === "start") return "idling";
  if (value === "stop" || value === "stopped") return "stopped";
  return "unknown";
}

/** One vehicle from FleetSmart's live view, before deciding whether it's a shuttle. */
interface LiveVehicle {
  id: string;
  registration: string;
  icon: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedMph: number | null;
  status: VehicleStatus;
  address: string;
  updatedAt: string | null;
}

function parseLiveViews(documents: JsonApiDocument[]): LiveVehicle[] {
  const included = new Map<string, Resource>();
  for (const doc of documents) {
    for (const resource of doc.included ?? []) {
      included.set(`${resource.type}:${resource.id}`, resource);
    }
  }
  const lookup = (ref?: ResourceIdentifier | null) =>
    ref ? included.get(`${ref.type}:${ref.id}`) : undefined;

  const vehicles: LiveVehicle[] = [];
  for (const liveView of documents.flatMap((doc) => doc.data)) {
    const vehicle = lookup(liveView.relationships?.vehicle?.data);
    const location = lookup(liveView.relationships?.vehicle_location?.data);
    const lat = asNumber(location?.attributes.latitude);
    const lng = asNumber(location?.attributes.longitude);
    if (!vehicle || lat === null || lng === null) continue;

    const status = toStatus(asString(liveView.attributes.status));
    // Moving: the heading is the direction of travel. Parked: FleetSmart keeps the last
    // heading for some vehicles but reports 0 for most, so treat a parked 0 as unknown.
    const reported = asNumber(location?.attributes.heading);
    const address = [asString(location?.attributes.address), asString(location?.attributes.postcode)]
      .filter(Boolean)
      .join(", ");

    vehicles.push({
      id: vehicle.id,
      registration: asString(vehicle.attributes.vrn) || "Unknown",
      icon: asString(vehicle.attributes.icon),
      lat,
      lng,
      heading: status === "moving" || reported !== 0 ? reported : null,
      speedMph: asNumber(location?.attributes.speed),
      status,
      address: address || "Address unavailable",
      updatedAt:
        asString(liveView.attributes.updated_at) || asString(location?.attributes.date_time) || null,
    });
  }
  return vehicles;
}

const isMinibusWithin = (vehicle: LiveVehicle, km: number) =>
  vehicle.icon.includes("bus") && distanceMetres(STUDIO_LOCATION, vehicle) <= km * 1000;

// ---------------------------------------------------------------------------
// Route detection: which minibuses are shuttles, and on which route.
// ---------------------------------------------------------------------------

interface Detection {
  at: number;
  /** Detected shuttles: FleetSmart vehicle id -> route. */
  routes: Map<string, RouteId>;
}

let detection: Detection | null = null;
let detecting: Promise<void> | null = null;
let lastDetectionFailureAt = 0;
/** Minibuses near the studio from the latest live fetch: the vehicles detection checks. */
let detectionCandidates: Array<Pick<LiveVehicle, "id" | "registration">> = [];

async function fetchTrack(vehicleId: string, since: Date): Promise<TrackPoint[]> {
  const points: TrackPoint[] = [];
  for (let page = 1; page <= HISTORY_MAX_PAGES; page++) {
    const doc = await fleetSmartGet("vehicle_locations", {
      "filter[vehicle_id]": vehicleId,
      "filter[date_time][gt]": since.toISOString(),
      sort: "date_time",
      "page[size]": String(HISTORY_PAGE_SIZE),
      "page[number]": String(page),
    });
    for (const location of doc.data) {
      const lat = asNumber(location.attributes.latitude);
      const lng = asNumber(location.attributes.longitude);
      if (lat !== null && lng !== null) points.push({ lat, lng, time: asString(location.attributes.date_time) });
    }
    if (doc.data.length < HISTORY_PAGE_SIZE) break;
  }
  return points.sort((a, b) => a.time.localeCompare(b.time));
}

async function detectRoutes(candidates: typeof detectionCandidates): Promise<Detection> {
  const since = new Date(Date.now() - DETECTION_LOOKBACK_MS);
  const routes = new Map<string, RouteId>();
  for (const candidate of candidates) {
    const routeId = routeFromEvidence(countVisits(await fetchTrack(candidate.id, since)));
    if (routeId) routes.set(candidate.id, routeId);
  }
  console.info(
    `[route-detection] ${routes.size} shuttle(s) found among ${candidates.length} minibus(es):`,
    candidates.filter((c) => routes.has(c.id)).map((c) => `${c.registration}→${routes.get(c.id)}`).join(", ") || "none",
  );
  return { at: Date.now(), routes };
}

/**
 * Re-runs route detection in the background when it is due (hourly). Safe to call
 * on every request: it does nothing while a run is in progress or not yet due.
 */
export async function refreshRouteDetection(): Promise<void> {
  if (!hasFleetSmartCredentials() || detecting || detectionCandidates.length === 0) return;
  const now = Date.now();
  if (detection && now - detection.at < DETECTION_REFRESH_MS) return;
  if (now - lastDetectionFailureAt < DETECTION_RETRY_MS) return;

  detecting = detectRoutes(detectionCandidates)
    .then((result) => {
      detection = result;
      cached = null; // apply the new routes on the next poll
    })
    .catch((error: unknown) => {
      lastDetectionFailureAt = Date.now();
      console.error("[route-detection]", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      detecting = null;
    });
  return detecting;
}

// ---------------------------------------------------------------------------
// Live snapshot
// ---------------------------------------------------------------------------

function toSnapshotVehicles(live: LiveVehicle[]): { vehicles: Vehicle[]; notice?: string } {
  detectionCandidates = live
    .filter((v) => isMinibusWithin(v, DETECTION_RADIUS_KM))
    .map(({ id, registration }) => ({ id, registration }));

  const routeOf = (v: LiveVehicle): { code: string; routeId: RouteId } | null => {
    const manual = ASSIGNMENTS_BY_VRN.get(normaliseVrn(v.registration));
    if (manual) return manual;
    const detected = detection?.routes.get(v.id);
    return detected ? { code: normaliseVrn(v.registration), routeId: detected } : null;
  };

  const shuttles = live.filter((v) => routeOf(v) !== null);
  // Until shuttles are known, show every minibus near the studio so the map isn't empty.
  const showAllNearby = shuttles.length === 0;
  const shown = showAllNearby ? live.filter((v) => isMinibusWithin(v, SHUTTLE_SEARCH_RADIUS_KM)) : shuttles;

  let notice: string | undefined;
  if (showAllNearby) {
    notice = detection
      ? `No shuttle loops found in the last 3 days, so every minibus within ${SHUTTLE_SEARCH_RADIUS_KM} km of the studio is shown.`
      : `Working out each minibus's route from its recent trips… Showing every minibus within ${SHUTTLE_SEARCH_RADIUS_KM} km of the studio for now.`;
  }

  const vehicles = shown.map((v): Vehicle => {
    const assignment = routeOf(v);
    const routeId = assignment?.routeId ?? null;
    return {
      id: v.id,
      code: assignment?.code ?? normaliseVrn(v.registration),
      routeId,
      registration: v.registration,
      lat: v.lat,
      lng: v.lng,
      heading: v.heading,
      speedMph: v.speedMph,
      status: v.status,
      address: v.address,
      updatedAt: v.updatedAt,
      nextDestination: estimateNextDestination(v, routeId, v.heading, v.status),
    };
  });

  vehicles.sort((a, b) => (a.routeId ?? 99) - (b.routeId ?? 99) || a.code.localeCompare(b.code));
  return { vehicles, notice };
}

async function fetchLiveVehicles(): Promise<LiveVehicle[]> {
  const documents: JsonApiDocument[] = [];
  for (let page = 1; page <= LIVE_MAX_PAGES; page++) {
    const doc = await fleetSmartGet("live_views", {
      include: "vehicle,vehicle_location",
      "page[size]": String(LIVE_PAGE_SIZE),
      "page[number]": String(page),
    });
    documents.push(doc);
    if (doc.data.length < LIVE_PAGE_SIZE) break;
  }
  return parseLiveViews(documents);
}

let cached: { at: number; snapshot: FleetSnapshot } | null = null;
let inFlight: Promise<FleetSnapshot> | null = null;

/** Live snapshot, shared across requests so the API rate limit is respected. */
export async function getLiveSnapshot(): Promise<FleetSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.snapshot;
  if (inFlight) return inFlight;

  inFlight = fetchLiveVehicles()
    .then((live) => {
      const { vehicles, notice } = toSnapshotVehicles(live);
      const snapshot: FleetSnapshot = { mode: "live", vehicles, fetchedAt: new Date().toISOString() };
      if (notice) snapshot.notice = notice;
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
