import { SHUTTLE_SEARCH_RADIUS_KM, VEHICLE_ASSIGNMENTS } from "@/config/vehicle-assignments";
import { distanceMetres, estimateNextDestination } from "./destination";
import { STUDIO_LOCATION } from "./routes";
import type { FleetSnapshot, Vehicle, VehicleStatus } from "./types";

// API guide: https://apiguide.fleetsmartlive.com/
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
  return response.json();
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

/** Without configured shuttles, fall back to minibuses near the studio. */
function isNearbyMinibus(icon: string, lat: number, lng: number): boolean {
  return (
    icon.includes("bus") &&
    distanceMetres(STUDIO_LOCATION, { lat, lng }) <= SHUTTLE_SEARCH_RADIUS_KM * 1000
  );
}

function toVehicles(documents: JsonApiDocument[]): Vehicle[] {
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
    const assignment = ASSIGNMENTS_BY_VRN.get(normaliseVrn(registration));
    if (ASSIGNMENTS_BY_VRN.size > 0 ? !assignment : !isNearbyMinibus(asString(vehicle.attributes.icon), lat, lng)) {
      continue;
    }
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
      address: address || "Address unavailable",
      updatedAt:
        asString(liveView.attributes.updated_at) || asString(location?.attributes.date_time) || null,
      nextDestination: estimateNextDestination({ lat, lng }, routeId, heading, status),
    });
  }

  return vehicles.sort(
    (a, b) => (a.routeId ?? 99) - (b.routeId ?? 99) || a.code.localeCompare(b.code),
  );
}

async function fetchLiveVehicles(): Promise<Vehicle[]> {
  const documents: JsonApiDocument[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(RATE_LIMIT_GAP_MS);
    const doc = await fetchPage(page);
    documents.push(doc);
    if (doc.data.length < PAGE_SIZE) break;
  }
  return toVehicles(documents);
}

let cached: { at: number; snapshot: FleetSnapshot } | null = null;
let inFlight: Promise<FleetSnapshot> | null = null;

/** Live snapshot, shared across requests so the API rate limit is respected. */
export async function getLiveSnapshot(): Promise<FleetSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.snapshot;
  if (inFlight) return inFlight;

  inFlight = fetchLiveVehicles()
    .then((vehicles) => {
      const snapshot: FleetSnapshot = { mode: "live", vehicles, fetchedAt: new Date().toISOString() };
      if (ASSIGNMENTS_BY_VRN.size === 0) {
        snapshot.notice = `Shuttles not configured yet: showing every minibus within ${SHUTTLE_SEARCH_RADIUS_KM} km of the studio. Add the shuttle registrations in src/config/vehicle-assignments.ts.`;
      }
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
