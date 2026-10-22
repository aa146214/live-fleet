import { VEHICLE_ASSIGNMENTS } from "@/config/vehicle-assignments";
import { isBannerColour, type Banner, type BannerInput, type MapBanner } from "./banners";
import { getSql, hasDatabase } from "./db";
import { DEFAULT_ROUTES, isPlaceId, type LatLng, isRouteColour, makeRoute, type PlaceId, type RouteColour, type ShuttleRoute } from "./routes";
import type { RouteId } from "./types";

/**
 * What the admin manages: the routes (a name, a colour and the stops, in order) and which
 * vehicles are on each. They live in the database; without one (or if it can't be reached)
 * the routes in routes.ts and the vehicles in vehicle-assignments.ts are used, so the map
 * keeps working. Server only.
 */

export interface Assignment {
  /** Registration without spaces, upper case. */
  vrn: string;
  /** The short code shown on the map (the number plate unless changed). */
  code: string;
  /** The route the vehicle is on, and so the stops it calls at. */
  routeId: RouteId;
}

/** What the admin sets for a route. `id` is absent for a new one. */
export interface RouteInput {
  id?: RouteId;
  name: string;
  shortName: string;
  colour: RouteColour;
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
let bannersCache: Cached<Banner[]> | undefined;
let markersCache: Cached<Map<string, LatLng>> | undefined;

const invalidate = () => {
  routesCache = undefined;
  assignmentsCache = undefined;
  bannersCache = undefined;
  markersCache = undefined;
};

const staticAssignments = (): Assignment[] =>
  Object.entries(VEHICLE_ASSIGNMENTS).map(([vrn, { code, routeId }]) => ({ vrn: normaliseVrn(vrn), code, routeId }));

function toRoute(row: Record<string, unknown>): ShuttleRoute {
  const colour = String(row.colour);
  return makeRoute({
    id: Number(row.id),
    name: String(row.name),
    shortName: String(row.short_name) || String(row.name),
    colour: isRouteColour(colour) ? colour : "blue",
    stops: String(row.stops ?? "").split(",").filter(isPlaceId),
  });
}

/** The routes the admin has made, in order (those in routes.ts without a database). */
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

/** The shuttles, keyed by registration. Only these are shown on the map. */
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
  const rows = await sql`select vrn, code, route_id from vehicle_assignments order by code`;
  return rows.map((r) => ({ vrn: String(r.vrn), code: String(r.code), routeId: Number(r.route_id) }));
}

async function readRoutes(): Promise<ShuttleRoute[]> {
  const sql = await getSql();
  const rows = await sql`select id, name, short_name, colour, stops from routes order by position, id`;
  return rows.map(toRoute);
}

// --- Used by the admin pages (these read the database directly, not the cache) ---

export const adminListAssignments = readAssignments;
export const adminListRoutes = readRoutes;

/** Saves a route, adding it if it has no id; returns its id. */
export async function adminSaveRoute(route: RouteInput): Promise<RouteId> {
  const sql = await getSql();
  const stops = route.stops.join(",");
  let id = route.id;
  if (id === undefined) {
    const rows = await sql`
      insert into routes (id, name, short_name, colour, stops, position)
      values (
        (select coalesce(max(id), 0) + 1 from routes), ${route.name}, ${route.shortName}, ${route.colour}, ${stops},
        (select coalesce(max(position), 0) + 1 from routes))
      returning id`;
    id = Number(rows[0].id);
  } else {
    await sql`
      update routes set name = ${route.name}, short_name = ${route.shortName}, colour = ${route.colour},
        stops = ${stops}, updated_at = now()
      where id = ${id}`;
  }
  invalidate();
  return id;
}

/** Deletes a route and takes its minibuses off the map (they go back to the unassigned list). */
export async function adminDeleteRoute(id: RouteId): Promise<void> {
  const sql = await getSql();
  await sql`delete from vehicle_assignments where route_id = ${id}`;
  await sql`delete from routes where id = ${id}`;
  invalidate();
}

export async function adminSaveAssignment(assignment: Assignment): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into vehicle_assignments (vrn, code, route_id)
    values (${assignment.vrn}, ${assignment.code}, ${assignment.routeId})
    on conflict (vrn) do update set code = excluded.code, route_id = excluded.route_id, updated_at = now()`;
  invalidate();
}

export async function adminDeleteAssignment(vrn: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from vehicle_assignments where vrn = ${normaliseVrn(vrn)}`;
  invalidate();
}

// --- News banners ---

const isoOf = (value: unknown) => (value ? new Date(value as string | Date).toISOString() : null);

function toBanner(row: Record<string, unknown>): Banner {
  const colour = String(row.colour);
  return {
    id: Number(row.id),
    message: String(row.message),
    colour: isBannerColour(colour) ? colour : "navy",
    link: String(row.link ?? ""),
    active: Boolean(row.active),
    startsAt: isoOf(row.starts_at),
    endsAt: isoOf(row.ends_at),
  };
}

/** Newest first. */
async function readBanners(): Promise<Banner[]> {
  const sql = await getSql();
  const rows = await sql`select id, message, colour, link, active, starts_at, ends_at from banners order by id desc`;
  return rows.map(toBanner);
}

/**
 * The banners the map should consider: those that are on and haven't ended (the map checks the
 * start and end as time passes). None without a database or if it can't be read: a banner
 * is never worth holding up the map for.
 */
export async function getBanners(): Promise<MapBanner[]> {
  if (!hasDatabase()) return [];
  if (!bannersCache || Date.now() - bannersCache.at >= CACHE_MS) {
    try {
      bannersCache = { at: Date.now(), value: await readBanners() };
    } catch (error) {
      console.error("[config] could not read banners:", error instanceof Error ? error.message : error);
      if (!bannersCache) return [];
    }
  }
  const now = Date.now();
  return bannersCache.value
    .filter((banner) => banner.active && !(banner.endsAt && Date.parse(banner.endsAt) <= now))
    .map(({ id, message, colour, link, startsAt, endsAt }) => ({ id, message, colour, link, startsAt, endsAt }));
}

export const adminListBanners = readBanners;

/** Saves a banner, adding it if it has no id. */
export async function adminSaveBanner(banner: BannerInput): Promise<void> {
  const sql = await getSql();
  if (banner.id === undefined) {
    await sql`
      insert into banners (message, colour, link, active, starts_at, ends_at)
      values (${banner.message}, ${banner.colour}, ${banner.link}, ${banner.active}, ${banner.startsAt}, ${banner.endsAt})`;
  } else {
    await sql`
      update banners set message = ${banner.message}, colour = ${banner.colour}, link = ${banner.link},
        active = ${banner.active}, starts_at = ${banner.startsAt}, ends_at = ${banner.endsAt}, updated_at = now()
      where id = ${banner.id}`;
  }
  invalidate();
}

export async function adminDeleteBanner(id: number): Promise<void> {
  const sql = await getSql();
  await sql`delete from banners where id = ${id}`;
  invalidate();
}

// --- Map markers ---

/** Where a place's pin is drawn instead of where the place is, keyed by place id. */
async function readMarkers(): Promise<Map<string, LatLng>> {
  const sql = await getSql();
  const rows = await sql`select place_id, lat, lng from place_markers`;
  return new Map(rows.map((r) => [String(r.place_id), { lat: Number(r.lat), lng: Number(r.lng) }]));
}

/** The pin positions the admin has set (none without a database, or if it can't be read). */
export async function getMarkers(): Promise<Map<string, LatLng>> {
  if (!hasDatabase()) return new Map();
  if (markersCache && Date.now() - markersCache.at < CACHE_MS) return markersCache.value;
  try {
    const value = await readMarkers();
    markersCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error("[config] could not read markers:", error instanceof Error ? error.message : error);
    return markersCache?.value ?? new Map();
  }
}

export const adminListMarkers = readMarkers;

export async function adminSaveMarker(placeId: string, position: LatLng): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into place_markers (place_id, lat, lng) values (${placeId}, ${position.lat}, ${position.lng})
    on conflict (place_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now()`;
  invalidate();
}

/** Puts a pin back where its place is. */
export async function adminDeleteMarker(placeId: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from place_markers where place_id = ${placeId}`;
  invalidate();
}
