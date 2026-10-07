import { distanceMetres } from "./destination";
import type { RoadRoute, Street } from "./polyline-simulation";
import type { LatLng } from "./routes";
import type { Vehicle } from "./types";

/**
 * The road each minibus drove between its last two reports, so the map can move it
 * along the road instead of in a straight line. Looked up with Valhalla's route
 * service using bus routing, which allows bus-only roads that car routers detour
 * around (https://valhalla.github.io/valhalla/api/route/api-reference/).
 *
 * The public FOSSGIS server is for light, non-commercial use; set VALHALLA_URL to a
 * hosted or self-run Valhalla before going live.
 */
const VALHALLA_URL = process.env.VALHALLA_URL ?? "https://valhalla1.openstreetmap.de";
const ROUTER_GAP_MS = 1100;
const ROUTER_TIMEOUT_MS = 4000;

/** Shorter moves are GPS jitter or parking; not worth a road lookup. */
const MIN_MOVE_M = 25;
/** Reports further apart than this are a data gap, not one drive. */
const MAX_GAP_MS = 5 * 60_000;
/** A route this much longer than the straight line is probably a wrong guess (e.g. a U-turn). */
const MAX_DETOUR = 3;
const MAX_DETOUR_EXTRA_M = 300;
/**
 * A route longer than the minibus could have driven is wrong: allow its faster
 * reported speed (at least MIN_ALLOWED_SPEED_MPH) times this margin, plus a little.
 */
const SPEED_MARGIN = 1.5;
const MIN_ALLOWED_SPEED_MPH = 20;
const DISTANCE_SLACK_M = 100;
const MPH_TO_MPS = 0.44704;
/** How far the router may move a report onto a road. */
const SNAP_RADIUS_M = 50;
/** How closely the road at each end must match the minibus's heading. */
const HEADING_TOLERANCE = 60;

interface Report extends LatLng {
  at: string;
  heading: number | null;
  speedMph: number | null;
}

interface Transition {
  from: Report | null;
  to: Report;
  path?: LatLng[] | null;
}

/** The latest two reports per vehicle, with the road between them once known. */
const transitions = new Map<string, Transition>();

let routerSlot = Promise.resolve();
/** Spaces router requests at least ROUTER_GAP_MS apart. */
function routerTurn(): Promise<void> {
  const mine = routerSlot;
  routerSlot = routerSlot.then(() => new Promise<void>((resolve) => setTimeout(resolve, ROUTER_GAP_MS)));
  return mine;
}

/** Decodes an encoded polyline with 6 decimal places (Valhalla's shape format). */
function decodePolyline6(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: Math.round(lat / 10) / 1e5, lng: Math.round(lng / 10) / 1e5 });
  }
  return points;
}

const location = (report: Report) => ({
  lat: report.lat,
  lon: report.lng,
  radius: SNAP_RADIUS_M,
  // Start and finish facing the way the minibus was heading, so the route doesn't
  // begin with a U-turn or use the wrong side of a dual carriageway.
  ...(report.heading !== null ? { heading: Math.round(report.heading), heading_tolerance: HEADING_TOLERANCE } : {}),
});

async function fetchRoad(from: Report, to: Report): Promise<LatLng[] | null> {
  await routerTurn();
  const request = {
    locations: [location(from), location(to)],
    costing: "bus",
    directions_type: "none",
    units: "kilometers",
  };
  try {
    const response = await fetch(`${VALHALLA_URL}/route?json=${encodeURIComponent(JSON.stringify(request))}`, {
      headers: { "User-Agent": "leavesden-shuttle-live-map" },
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const trip = (await response.json())?.trip;
    const shape: unknown = trip?.legs?.[0]?.shape;
    if (typeof shape !== "string") return null;

    const distance = Number(trip.summary?.length) * 1000;
    const straight = distanceMetres(from, to);
    const seconds = (Date.parse(to.at) - Date.parse(from.at)) / 1000;
    if (!(distance > 0) || distance > straight * MAX_DETOUR + MAX_DETOUR_EXTRA_M) return null;
    const speedMph = Math.max(from.speedMph ?? 0, to.speedMph ?? 0, MIN_ALLOWED_SPEED_MPH);
    if (distance > speedMph * MPH_TO_MPS * SPEED_MARGIN * seconds + DISTANCE_SLACK_M) return null;

    const points = decodePolyline6(shape);
    return points.length >= 2 ? points : null;
  } catch {
    return null;
  }
}

interface ValhallaManeuver {
  street_names?: string[];
  begin_shape_index?: number;
}

/**
 * The bus route through `stops`, with the street it follows along the way, or null if
 * the router can't find one. Used by the demo, which has no reports to route between.
 */
export async function fetchBusRoute(stops: LatLng[]): Promise<RoadRoute | null> {
  if (stops.length < 2) return null;
  await routerTurn();
  const request = {
    locations: stops.map((stop) => ({ lat: stop.lat, lon: stop.lng, radius: SNAP_RADIUS_M })),
    costing: "bus",
    directions_type: "maneuvers",
    units: "kilometers",
  };
  try {
    const response = await fetch(`${VALHALLA_URL}/route?json=${encodeURIComponent(JSON.stringify(request))}`, {
      headers: { "User-Agent": "leavesden-shuttle-live-map" },
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const legs: { shape?: string; maneuvers?: ValhallaManeuver[] }[] = (await response.json())?.trip?.legs ?? [];

    const polyline: LatLng[] = [];
    const streets: Street[] = [];
    const along: number[] = []; // distance from the start to each point of `polyline`
    for (const leg of legs) {
      if (typeof leg.shape !== "string") return null;
      // Each leg starts where the last ended; maneuver indexes count from the leg's own start.
      const base = polyline.length === 0 ? 0 : polyline.length - 1;
      const points = decodePolyline6(leg.shape);
      for (const point of polyline.length === 0 ? points : points.slice(1)) {
        along.push(polyline.length === 0 ? 0 : along[along.length - 1] + distanceMetres(polyline[polyline.length - 1], point));
        polyline.push(point);
      }
      for (const maneuver of leg.maneuvers ?? []) {
        const name = maneuver.street_names?.[0];
        const fromMeters = along[base + (maneuver.begin_shape_index ?? 0)];
        if (name && fromMeters !== undefined && name !== streets[streets.length - 1]?.name) {
          streets.push({ fromMeters, name });
        }
      }
    }
    return polyline.length >= 2 ? { polyline, streets } : null;
  } catch {
    return null;
  }
}

interface NearestRoad {
  street: string | null;
  /** The nearest point on the road. */
  point: LatLng | null;
}

/** Roads already looked up, by position rounded to about a metre. */
const nearestRoads = new Map<string, NearestRoad>();
const roadLookups = new Set<string>();
const MAX_NEAREST_ROADS = 500;

/**
 * The road nearest `position` according to the router, if it has been looked up. The
 * first call for a spot starts the lookup in the background and returns undefined;
 * later calls (the next snapshot) get the answer.
 */
export function nearestRoad(position: LatLng): NearestRoad | undefined {
  const key = `${position.lat.toFixed(5)},${position.lng.toFixed(5)}`;
  const known = nearestRoads.get(key);
  if (known) return known;
  if (roadLookups.has(key)) return undefined;
  roadLookups.add(key);
  void lookUpRoad(position).then((road) => {
    if (nearestRoads.size >= MAX_NEAREST_ROADS) nearestRoads.clear();
    nearestRoads.set(key, road);
    roadLookups.delete(key);
  });
  return undefined;
}

/** The name of the road nearest `position`; see `nearestRoad`. */
export const streetNear = (position: LatLng): string | undefined => nearestRoad(position)?.street ?? undefined;

async function lookUpRoad(position: LatLng): Promise<NearestRoad> {
  const none = { street: null, point: null };
  await routerTurn();
  const request = {
    locations: [{ lat: position.lat, lon: position.lng, radius: SNAP_RADIUS_M }],
    costing: "bus",
    verbose: true,
  };
  try {
    const response = await fetch(`${VALHALLA_URL}/locate?json=${encodeURIComponent(JSON.stringify(request))}`, {
      headers: { "User-Agent": "leavesden-shuttle-live-map" },
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) return none;
    const edges: {
      distance?: number;
      correlated_lat?: number;
      correlated_lon?: number;
      edge_info?: { names?: string[] };
    }[] = (await response.json())?.[0]?.edges ?? [];
    const nearest = [...edges].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];
    const named = edges.find((edge) => edge.edge_info?.names?.[0]);
    return {
      street: named?.edge_info?.names?.[0] ?? null,
      point:
        nearest?.correlated_lat !== undefined && nearest.correlated_lon !== undefined
          ? { lat: nearest.correlated_lat, lng: nearest.correlated_lon }
          : null,
    };
  } catch {
    return none;
  }
}

function reportOf(vehicle: Vehicle): Report | null {
  if (!vehicle.updatedAt) return null;
  return {
    lat: vehicle.lat,
    lng: vehicle.lng,
    at: vehicle.updatedAt,
    heading: vehicle.heading,
    speedMph: vehicle.speedMph,
  };
}

function needsRoad(from: Report | null, to: Report): from is Report {
  if (!from) return false;
  const gap = Date.parse(to.at) - Date.parse(from.at);
  return gap > 0 && gap <= MAX_GAP_MS && distanceMetres(from, to) >= MIN_MOVE_M;
}

/**
 * Adds `road` to each vehicle whose road since its previous report is known. New
 * lookups get up to `waitMs`; slower ones are attached to later snapshots.
 */
export async function attachRoads(vehicles: Vehicle[], waitMs: number): Promise<void> {
  const lookups: Promise<unknown>[] = [];
  for (const vehicle of vehicles) {
    const report = reportOf(vehicle);
    if (!report) continue;
    const known = transitions.get(vehicle.id);
    if (known && known.to.at === report.at) continue;

    const from = known?.to ?? null;
    const transition: Transition = { from, to: report };
    transitions.set(vehicle.id, transition);
    if (needsRoad(from, report)) {
      lookups.push(
        fetchRoad(from, report).then((path) => {
          transition.path = path;
        }),
      );
    }
  }

  if (lookups.length > 0) {
    await Promise.race([Promise.allSettled(lookups), new Promise((resolve) => setTimeout(resolve, waitMs))]);
  }

  for (const vehicle of vehicles) {
    const transition = transitions.get(vehicle.id);
    if (transition?.from && transition.path && transition.to.at === vehicle.updatedAt) {
      vehicle.road = { since: transition.from.at, points: transition.path };
    }
  }
}
