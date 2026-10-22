import { distanceMetres } from "./destination";
import type { RoadRoute, Street } from "./polyline-simulation";
import { loadTransitions, saveTransition, type Report, type Transition } from "./report-store";
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
const MAX_DETOUR_EXTRA_M = 100;
/** Shorter than this, a hop is a straight line on the map too (see SNAP_DISTANCE_M in motion.ts). */
const SHORT_HOP_M = 60;
const SHORT_HOP_EXTRA_M = 30;
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
/** The same, on the second try for a road that the first found nothing for. */
const LOOSE_SNAP_RADIUS_M = 80;
/** How closely the road at each end must match the minibus's heading. */
const HEADING_TOLERANCE = 60;

export type { Report };

/** The latest two reports per vehicle, with the road between them once known (this server's copy of report-store). */
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

/** How the road between two reports is asked for. */
interface RoadQuery {
  /** Start and finish facing the way the minibus was heading. */
  heading: boolean;
  radius: number;
}
/** The usual question, then a looser one for places where the first finds no road (private roads, car parks). */
const ROAD_QUERIES: RoadQuery[] = [
  { heading: true, radius: SNAP_RADIUS_M },
  { heading: false, radius: LOOSE_SNAP_RADIUS_M },
];

const location = (report: Report, query: RoadQuery) => ({
  lat: report.lat,
  lon: report.lng,
  radius: query.radius,
  // Start and finish facing the way the minibus was heading, so the route doesn't begin with a
  // U-turn or use the wrong side of a dual carriageway. Only while it was moving: a stopped
  // tracker keeps an old heading, and making the road end facing that way sends the route round
  // the block (a bus that had stopped at a junction was drawn spinning round and back).
  ...(query.heading && report.heading !== null && (report.speedMph ?? 0) > 0
    ? { heading: Math.round(report.heading), heading_tolerance: HEADING_TOLERANCE }
    : {}),
});

const lengthOf = (points: LatLng[]) => points.slice(1).reduce((sum, point, i) => sum + distanceMetres(points[i], point), 0);

/** A road this much longer than the straight line is checked against one found without the heading hints. */
const SUSPICIOUS_RATIO = 1.5;
const SUSPICIOUS_EXTRA_M = 30;

/**
 * The road between two reports. A straight line across the blocks is the last resort, so ask
 * again (looser) when nothing is found. When the road is much longer than the straight line, it
 * is checked against the road without the heading hints, and the shorter one wins if the hints
 * are what made it long.
 */
async function fetchRoad(from: Report, to: Report): Promise<LatLng[] | null> {
  for (const query of ROAD_QUERIES) {
    const road = await fetchRoadWith(from, to, query);
    if (!road) continue;
    const hinted = query.heading && (from.heading !== null || to.heading !== null);
    if (hinted && lengthOf(road) > distanceMetres(from, to) * SUSPICIOUS_RATIO + SUSPICIOUS_EXTRA_M) {
      const plain = await fetchRoadWith(from, to, { heading: false, radius: query.radius });
      if (plain && lengthOf(road) > lengthOf(plain) * SUSPICIOUS_RATIO + SUSPICIOUS_EXTRA_M) return plain;
    }
    return road;
  }
  return null;
}

async function fetchRoadWith(from: Report, to: Report, query: RoadQuery): Promise<LatLng[] | null> {
  await routerTurn();
  const request = {
    locations: [location(from, query), location(to, query)],
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
    // A hop this short is drawn as a straight line anyway; a road that loops round a block
    // for it (one-way streets, turn rules) would look like the minibus spinning round.
    if (straight < SHORT_HOP_M && distance > straight * 2 + SHORT_HOP_EXTRA_M) return null;
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

/** The trackers report about once a minute; a stored report further back than this isn't the one just before. */
const ADJACENT_GAP_MS = 100_000;
/** A report older than this isn't worth a history lookup: the map doesn't replay its drive (see motion.ts). */
const RECENT_REPORT_MS = 150_000;

/** The report just before `report`, from FleetSmart's history, or null if it can't be had. */
export type PreviousReport = (vehicle: Vehicle, report: Report) => Promise<Report | null>;

/**
 * Adds `road` to each vehicle whose road since its previous report is known. The previous
 * report comes from this server's memory, or from the database (another server may have seen
 * it), and, when that isn't the report just before (nobody was watching for a while, or the
 * server is new), from FleetSmart's history, so a map opened cold still has the road to draw.
 * New lookups get up to `waitMs`; slower ones carry on and are attached to later snapshots.
 */
export async function attachRoads(vehicles: Vehicle[], waitMs: number, previousReport?: PreviousReport): Promise<void> {
  const fresh: { vehicle: Vehicle; report: Report; known: Transition | undefined }[] = [];
  for (const vehicle of vehicles) {
    const report = reportOf(vehicle);
    if (!report) continue;
    const known = transitions.get(vehicle.id);
    if (known && known.to.at === report.at) continue;
    fresh.push({ vehicle, report, known });
  }

  const lookups: Promise<unknown>[] = [];
  if (fresh.length > 0) {
    // Another server (or this one before it restarted) may have dealt with these already.
    const stored = await loadTransitions(fresh.map((item) => item.vehicle.id));
    for (const { vehicle, report, known } of fresh) {
      const saved = stored.get(vehicle.id);
      if (saved && saved.to.at === report.at) {
        transitions.set(vehicle.id, saved);
        continue;
      }
      // Another server has already seen a newer report than this one's (its fetch was earlier):
      // leave what is stored alone.
      if (saved && Date.parse(saved.to.at) > Date.parse(report.at)) continue;
      const before = [known?.to, saved?.to].filter((r): r is Report => Boolean(r)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      const transition: Transition = { from: before ?? null, to: report };
      transitions.set(vehicle.id, transition);
      lookups.push(resolveRoad(vehicle, transition, previousReport));
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

/** Finds the report before this one if need be, then the road between them, and keeps both. */
async function resolveRoad(vehicle: Vehicle, transition: Transition, previousReport?: PreviousReport): Promise<void> {
  const { to } = transition;
  const gap = transition.from ? Date.parse(to.at) - Date.parse(transition.from.at) : Infinity;
  const recent = Date.now() - Date.parse(to.at) <= RECENT_REPORT_MS;
  if (gap > ADJACENT_GAP_MS && recent && previousReport) {
    const previous = await previousReport(vehicle, to).catch(() => null);
    if (previous && Date.parse(previous.at) < Date.parse(to.at)) transition.from = previous;
  }
  const { from } = transition;
  transition.path = needsRoad(from, to) ? await fetchRoad(from, to) : null;
  await saveTransition(vehicle.id, transition);
}
