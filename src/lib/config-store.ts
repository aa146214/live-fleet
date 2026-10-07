import { VEHICLE_ASSIGNMENTS } from "@/config/vehicle-assignments";
import { getSql, hasDatabase } from "./db";
import { DEFAULT_ROUTES, defaultStops, getRoute, isPlaceId, type PlaceId, type ShuttleRoute } from "./routes";
import type { RouteId } from "./types";

/**
 * The settings the admin manages: which vehicles are shuttles (and on which route), and
 * each route's name, station and what3words address. They live in the database; without
 * one (or if it can't be reached) the defaults in code are used, so the map keeps working.
 * Server only.
 */

export interface Assignment {
  /** Registration without spaces, upper case. */
  vrn: string;
  /** The short code shown on the map, e.g. "W1". */
  code: string;
  /** The route it is on (that of the first station among its stops). */
  routeId: RouteId;
  /** The places it calls at, in order, then back to the first. */
  stops: PlaceId[];
}

export const normaliseVrn = (vrn: string) => vrn.replace(/\s+/g, "").toUpperCase();

/** How long reads are reused, so each poll doesn't query the database. */
const CACHE_MS = 30_000;

interface Cached<T> {
  at: number;
  value: T;
}
let routesCache: Cached<ShuttleRoute[]> | undefined;
let assignmentsCache: Cached<Assignment[]> | undefined;

const invalidate = () => {
  routesCache = undefined;
  assignmentsCache = undefined;
};

const asRouteId = (value: unknown): RouteId => Number(value) as RouteId;

const defaultsFor = (routeId: RouteId) => defaultStops(getRoute(DEFAULT_ROUTES, routeId) ?? DEFAULT_ROUTES[0]);

const staticAssignments = (): Assignment[] =>
  Object.entries(VEHICLE_ASSIGNMENTS).map(([vrn, { code, routeId }]) => ({
    vrn: normaliseVrn(vrn),
    code,
    routeId,
    stops: defaultsFor(routeId),
  }));

/** Reads a stored assignment; vehicles saved before stops existed get their route's usual stops. */
function toAssignment(row: Record<string, unknown>): Assignment {
  const routeId = asRouteId(row.route_id);
  const stops = String(row.stops ?? "").split(",").filter(isPlaceId);
  return { vrn: String(row.vrn), code: String(row.code), routeId, stops: stops.length >= 2 ? stops : defaultsFor(routeId) };
}

/** The routes with the admin's edits applied. */
export async function getRoutes(): Promise<ShuttleRoute[]> {
  if (!hasDatabase()) return DEFAULT_ROUTES;
  if (routesCache && Date.now() - routesCache.at < CACHE_MS) return routesCache.value;
  try {
    const value = await readRoutes();
    routesCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error("[config] could not read routes:", error instanceof Error ? error.message : error);
    return routesCache?.value ?? DEFAULT_ROUTES;
  }
}

/** The shuttles, or none (meaning "show minibuses near the studio") if nothing is set up. */
export async function getAssignments(): Promise<Map<string, Assignment>> {
  const list = await listAssignments();
  return new Map(list.map((assignment) => [assignment.vrn, assignment]));
}

async function listAssignments(): Promise<Assignment[]> {
  if (!hasDatabase()) return staticAssignments();
  if (assignmentsCache && Date.now() - assignmentsCache.at < CACHE_MS) return assignmentsCache.value;
  try {
    const value = await readAssignments();
    assignmentsCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error("[config] could not read assignments:", error instanceof Error ? error.message : error);
    return assignmentsCache?.value ?? staticAssignments();
  }
}

async function readAssignments(): Promise<Assignment[]> {
  const sql = await getSql();
  const rows = await sql`select vrn, code, route_id, stops from vehicle_assignments order by code`;
  return rows.map(toAssignment);
}

async function readRoutes(): Promise<ShuttleRoute[]> {
  const sql = await getSql();
  const rows = await sql`
    select id, name, station, terminus, what3words, station_lat, station_lng from routes order by id`;
  return DEFAULT_ROUTES.map((route) => {
    const row = rows.find((r) => asRouteId(r.id) === route.id);
    return row
      ? {
          ...route,
          name: String(row.name),
          station: String(row.station),
          terminus: String(row.terminus),
          what3words: String(row.what3words),
          stationLocation: { lat: Number(row.station_lat), lng: Number(row.station_lng) },
        }
      : route;
  });
}

// --- Used by the admin pages (these read the database directly, not the cache) ---

export const adminListAssignments = readAssignments;
export const adminListRoutes = readRoutes;
export async function adminSaveAssignment(assignment: Assignment): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into vehicle_assignments (vrn, code, route_id, stops)
    values (${assignment.vrn}, ${assignment.code}, ${assignment.routeId}, ${assignment.stops.join(",")})
    on conflict (vrn) do update set
      code = excluded.code, route_id = excluded.route_id, stops = excluded.stops, updated_at = now()`;
  invalidate();
}

export async function adminDeleteAssignment(vrn: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from vehicle_assignments where vrn = ${normaliseVrn(vrn)}`;
  invalidate();
}
