import {
  bearingDegrees,
  fetchRoute,
  haversineMeters,
  polylineLength,
  slicePolyline,
  type Street,
} from "./polyline-simulation";
import { fetchBusRoute } from "./road-paths";
import { destinationOf, getPlace, type LatLng, type Place, type ShuttleRoute } from "./routes";

/**
 * A shuttle's loop: the road through its stops in order, then back to the first. Each
 * leg between two stops is routed on its own, so one-way streets are respected in both
 * directions. The demo drives the loop; live mode places each minibus on it to tell
 * where it is going, what street it is on and what road lies ahead.
 */
export interface Loop {
  points: LatLng[];
  /** Length of the whole loop, in metres. */
  cycle: number;
  /** The street at each distance along the loop. */
  streets: Street[];
  /** Where the loop reaches each stop after the first (the last is the end of the loop). */
  arrivals: { name: string; along: number }[];
}

export const NO_LOOP: Loop = { points: [], cycle: 0, streets: [], arrivals: [] };

/** A place a shuttle calls at. `name` is how the next destination is written. */
export interface LoopStop {
  id: string;
  name: string;
  location: LatLng;
}

/** The stops for a list of place ids, or undefined if there are fewer than two or one is unknown. */
export function loopStopsFor(ids: readonly string[], places: Place[], routes: ShuttleRoute[]): LoopStop[] | undefined {
  const stops: LoopStop[] = [];
  for (const id of ids) {
    const place = getPlace(places, id);
    if (!place) return undefined;
    stops.push({ id, name: destinationOf(place, routes), location: { lat: place.lat, lng: place.lng } });
  }
  return stops.length >= 2 ? stops : undefined;
}

/** A loop that fell back to straight lines is looked up again after this long. */
const FALLBACK_RETRY_MS = 60_000;

interface Entry {
  at: number;
  roads: boolean;
  loop: Promise<Loop>;
  /** The loop once it has loaded. */
  ready?: Loop;
}

/** By stops and where they are, so an edited route or station gets its own loop. */
const loops = new Map<string, Entry>();
const keyOf = (stops: LoopStop[]) => stops.map((s) => `${s.id}@${s.location.lat},${s.location.lng}`).join(">");

/** Bus routing (OSRM's car roads if that fails; straight lines if both fail). */
const routeBetween = async (stops: LatLng[]) => (await fetchBusRoute(stops)) ?? fetchRoute(stops);

function entryFor(stops: LoopStop[]): Entry {
  const key = keyOf(stops);
  const cached = loops.get(key);
  if (cached && (cached.roads || Date.now() - cached.at < FALLBACK_RETRY_MS)) return cached;

  // Legs between consecutive stops, closed back to the first if the list doesn't end there.
  const legs: [LoopStop, LoopStop][] = stops.slice(1).map((stop, i) => [stops[i], stop]);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first.location.lat !== last.location.lat || first.location.lng !== last.location.lng) legs.push([last, first]);

  const entry: Entry = { at: Date.now(), roads: false, loop: Promise.resolve(NO_LOOP) };
  entry.loop = Promise.all(legs.map(([from, to]) => routeBetween([from.location, to.location]))).then((routes) => {
    // A two-point answer is the straight-line fallback; try the roads again soon.
    entry.roads = routes.every((route) => route.polyline.length > 2);
    const points: LatLng[] = [];
    const streets: Street[] = [];
    const arrivals: Loop["arrivals"] = [];
    let along = 0;
    routes.forEach((route, i) => {
      points.push(...(i === 0 ? route.polyline : route.polyline.slice(1)));
      for (const street of route.streets) {
        if (street.name !== streets[streets.length - 1]?.name) streets.push({ ...street, fromMeters: along + street.fromMeters });
      }
      along += polylineLength(route.polyline);
      arrivals.push({ name: legs[i][1].name, along });
    });
    const loop: Loop = { points, cycle: along, streets, arrivals };
    entry.ready = loop;
    return loop;
  });
  loops.set(key, entry);
  return entry;
}

/** The loop through `stops`, waiting up to `waitMs` for it to load (NO_LOOP if it hasn't by then). */
export function loopWithin(stops: LoopStop[], waitMs: number): Promise<Loop> {
  const entry = entryFor(stops);
  return Promise.race([entry.loop, new Promise<Loop>((resolve) => setTimeout(() => resolve(NO_LOOP), waitMs))]);
}

/** The loop through `stops` if it has loaded; otherwise starts loading it and returns undefined. */
export function loopIfReady(stops: LoopStop[]): Loop | undefined {
  const entry = entryFor(stops);
  return entry.ready && entry.ready.cycle > 0 ? entry.ready : undefined;
}

/** The stop a minibus `along` the loop reaches next. */
export function nextStop(loop: Loop, along: number): string {
  return (loop.arrivals.find((arrival) => arrival.along > along) ?? loop.arrivals[0]).name;
}

/** How far a minibus can be from the road and still count as on it. */
const ON_ROUTE_M = 150;
/** Roads about this close to the nearest one are candidates; the heading picks between them. */
const AMBIGUOUS_M = 25;

export interface LoopPosition {
  /** Distance along the loop, in metres. */
  along: number;
  /** The nearest point on the road, and how far the minibus is from it, in metres. */
  point: LatLng;
  distance: number;
}

/**
 * Where on the loop a minibus is, or null if it isn't near the road. A street driven
 * both ways, or more than once, is told apart by the minibus's heading.
 */
export function locateOnLoop(loop: Loop, position: LatLng, heading: number | null): LoopPosition | null {
  const cos = Math.cos((position.lat * Math.PI) / 180);
  const candidates: (LoopPosition & { bearing: number })[] = [];
  let start = 0;
  for (let i = 1; i < loop.points.length; i++) {
    const a = loop.points[i - 1];
    const b = loop.points[i];
    const length = haversineMeters(a, b);
    const abx = (b.lng - a.lng) * cos;
    const aby = b.lat - a.lat;
    const t = Math.min(
      Math.max(((position.lng - a.lng) * cos * abx + (position.lat - a.lat) * aby) / (abx * abx + aby * aby || 1), 0),
      1,
    );
    const point = { lat: a.lat + aby * t, lng: a.lng + (b.lng - a.lng) * t };
    const distance = haversineMeters(position, point);
    if (distance <= ON_ROUTE_M) {
      candidates.push({ along: start + t * length, point, distance, bearing: length > 0 ? bearingDegrees(a, b) : 0 });
    }
    start += length;
  }
  if (candidates.length === 0) return null;

  const nearest = Math.min(...candidates.map((c) => c.distance));
  const close = candidates.filter((c) => c.distance <= nearest + AMBIGUOUS_M);
  const off = (bearing: number) => (heading === null ? 0 : Math.abs(((bearing - heading + 540) % 360) - 180));
  const best = close.reduce((a, b) => (off(b.bearing) < off(a.bearing) || (off(b.bearing) === off(a.bearing) && b.distance < a.distance) ? b : a));
  return { along: best.along, point: best.point, distance: best.distance };
}

/** How much road is sent ahead of a moving minibus, in seconds of driving (more than a prediction lasts). */
const AHEAD_SECONDS = 120;
const MIN_AHEAD_M = 300;
const MAX_AHEAD_M = 3000;

/** The loop's road ahead of `along` for a minibus driving at `speed` m/s, continuing round from the start. */
export function roadAhead(loop: Loop, along: number, speed: number): LatLng[] {
  const meters = Math.min(Math.max(speed * AHEAD_SECONDS, MIN_AHEAD_M), MAX_AHEAD_M);
  const end = along + meters;
  if (end <= loop.cycle) return slicePolyline(loop.points, along, end);
  return [...slicePolyline(loop.points, along, loop.cycle), ...slicePolyline(loop.points, 0, end - loop.cycle)];
}
