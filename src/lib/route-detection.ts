import { distanceMetres } from "./destination";
import { ROUTES, type LatLng } from "./routes";
import type { RouteId } from "./types";

export interface TrackPoint extends LatLng {
  /** ISO timestamp; points must be in time order. */
  time: string;
}

export interface RouteEvidence {
  /** Arrivals at each route's station. */
  stationVisits: Record<RouteId, number>;
  /** Arrivals at the studio site. */
  studioVisits: number;
}

/** The whole studio site (both entrances and the depot), generously sized. */
export const STUDIO_AREA = { lat: 51.689, lng: -0.417, radius: 900 };
const STATION_RADIUS = 300;
/** A vehicle must move this much further out before it can arrive again (GPS jitter). */
const EXIT_FACTOR = 1.5;

/** A shuttle loops its station and the studio repeatedly; one-off visits don't count. */
export const MIN_STATION_VISITS = 2;
export const MIN_STUDIO_VISITS = 2;
/** The route's station must be visited at least this many times more than any other. */
const DOMINANCE = 2;

/** Counts arrivals at each station and at the studio along a vehicle's track. */
export function countVisits(points: TrackPoint[]): RouteEvidence {
  const zones = [
    { key: "studio" as const, ...STUDIO_AREA },
    ...ROUTES.map((route) => ({ key: route.id, ...route.stationLocation, radius: STATION_RADIUS })),
  ];
  const inside = new Map<string | RouteId, boolean>(zones.map((zone) => [zone.key, false]));
  const evidence: RouteEvidence = { stationVisits: { 1: 0, 2: 0, 3: 0 }, studioVisits: 0 };

  for (const point of points) {
    for (const zone of zones) {
      const distance = distanceMetres(point, zone);
      if (!inside.get(zone.key) && distance <= zone.radius) {
        inside.set(zone.key, true);
        if (zone.key === "studio") evidence.studioVisits += 1;
        else evidence.stationVisits[zone.key] += 1;
      } else if (inside.get(zone.key) && distance > zone.radius * EXIT_FACTOR) {
        inside.set(zone.key, false);
      }
    }
  }
  return evidence;
}

/**
 * The route a vehicle is shuttling on, judged from its recent trips: repeated
 * arrivals at one station and at the studio, with that station clearly ahead of
 * the others. Returns null for anything that doesn't look like a shuttle.
 */
export function routeFromEvidence({ stationVisits, studioVisits }: RouteEvidence): RouteId | null {
  if (studioVisits < MIN_STUDIO_VISITS) return null;
  const ranked = (Object.entries(stationVisits) as Array<[string, number]>)
    .map(([id, visits]) => ({ id: Number(id) as RouteId, visits }))
    .sort((a, b) => b.visits - a.visits);
  const [best, second] = ranked;
  if (best.visits < MIN_STATION_VISITS) return null;
  if (best.visits < DOMINANCE * second.visits) return null;
  return best.id;
}
