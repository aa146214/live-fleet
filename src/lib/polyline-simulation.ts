import type { LatLng } from "./routes";

export type { LatLng };

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const OSRM_TIMEOUT_MS = 8000;
const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in metres (Haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north (0–360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A road name from `fromMeters` along a route until the next entry. */
export interface Street {
  fromMeters: number;
  name: string;
}

export interface RoadRoute {
  polyline: LatLng[];
  /** The streets the route follows, in order; empty when the road isn't known. */
  streets: Street[];
}

interface OsrmStep {
  name?: string;
  ref?: string;
  geometry?: { coordinates?: [number, number][] };
}

/**
 * Fetches the road through `stops` from the public OSRM server, with the street it
 * follows at each point. OSRM takes and returns [longitude, latitude]; this converts
 * both ways. If the request fails for any reason (network, timeout, no route, bad
 * response) it falls back to the stops themselves, i.e. straight lines between them
 * with no street names, so callers always get a path.
 */
export async function fetchRoute(stops: LatLng[], signal?: AbortSignal): Promise<RoadRoute> {
  const fallback: RoadRoute = { polyline: [...stops], streets: [] };
  if (stops.length < 2) return fallback;

  const coordinates = stops.map((stop) => `${stop.lng},${stop.lat}`).join(";");
  const url = `${OSRM_URL}/${coordinates}?overview=false&steps=true&geometries=geojson`;
  const timeout = AbortSignal.timeout(OSRM_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
    const body = await response.json();
    const steps: OsrmStep[] = (body?.routes?.[0]?.legs ?? []).flatMap((leg: { steps?: OsrmStep[] }) => leg.steps ?? []);
    if (body?.code !== "Ok" || steps.length === 0) throw new Error("OSRM found no route");

    // The steps' geometries join end to end into the whole route.
    const polyline: LatLng[] = [];
    const streets: Street[] = [];
    let along = 0;
    for (const step of steps) {
      const points = (step.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
      if (points.length === 0) continue;
      const name = step.name || step.ref || "";
      if (name && name !== streets[streets.length - 1]?.name) streets.push({ fromMeters: along, name });
      for (const point of points) {
        const last = polyline[polyline.length - 1];
        if (last && last.lat === point.lat && last.lng === point.lng) continue;
        if (last) along += haversineMeters(last, point);
        polyline.push(point);
      }
    }
    if (polyline.length < 2) throw new Error("OSRM found no route");
    return { polyline, streets };
  } catch (error) {
    // A caller that aborted doesn't want a fallback path.
    if (signal?.aborted) throw error;
    console.warn("Road route unavailable, using straight lines between stops:", error);
    return fallback;
  }
}

/** Just the road geometry of `fetchRoute`. */
export async function fetchRoutePolyline(stops: LatLng[], signal?: AbortSignal): Promise<LatLng[]> {
  return (await fetchRoute(stops, signal)).polyline;
}

/** The street `meters` along a route, or undefined when the streets aren't known. */
export function streetAt(streets: Street[], meters: number): string | undefined {
  let name: string | undefined;
  for (const street of streets) {
    if (street.fromMeters > meters) break;
    name = street.name;
  }
  return name ?? streets[0]?.name;
}

export interface PolylinePosition {
  position: LatLng;
  /** Degrees clockwise from north, along the current segment. */
  heading: number;
  isFinished: boolean;
}

export function polylineLength(polyline: LatLng[]): number {
  let length = 0;
  for (let i = 1; i < polyline.length; i++) length += haversineMeters(polyline[i - 1], polyline[i]);
  return length;
}

/**
 * The point `meters` along `polyline`, with the heading of the segment it is on. Past
 * the end it stays on the final point and `isFinished` is true. An empty polyline
 * yields (0, 0); a single point yields that point, heading 0.
 */
export function positionAtDistance(polyline: LatLng[], meters: number): PolylinePosition {
  if (polyline.length === 0) return { position: { lat: 0, lng: 0 }, heading: 0, isFinished: true };
  if (polyline.length === 1) return { position: { ...polyline[0] }, heading: 0, isFinished: true };

  let remaining = Math.max(0, meters) || 0;
  let heading = 0;

  for (let i = 1; i < polyline.length; i++) {
    const from = polyline[i - 1];
    const to = polyline[i];
    const length = haversineMeters(from, to);
    // Zero-length segments have no direction; keep the previous heading.
    if (length > 0) heading = bearingDegrees(from, to);
    if (remaining <= length && length > 0) {
      const t = remaining / length;
      return {
        position: { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t },
        heading,
        isFinished: false,
      };
    }
    remaining -= length;
  }

  return { position: { ...polyline[polyline.length - 1] }, heading, isFinished: true };
}

/** The part of `polyline` between `fromMeters` and `toMeters` along it, ends included. */
export function slicePolyline(polyline: LatLng[], fromMeters: number, toMeters: number): LatLng[] {
  const result: LatLng[] = [positionAtDistance(polyline, fromMeters).position];
  let along = 0;
  for (let i = 1; i < polyline.length; i++) {
    along += haversineMeters(polyline[i - 1], polyline[i]);
    if (along > fromMeters && along < toMeters) result.push(polyline[i]);
  }
  result.push(positionAtDistance(polyline, toMeters).position);
  return result;
}

/**
 * Where a vehicle driving at `speedKmH` for `elapsedSeconds` along `polyline` is.
 * See `positionAtDistance` for the edge cases.
 */
export function getPositionAlongPolyline(
  polyline: LatLng[],
  speedKmH: number,
  elapsedSeconds: number,
): PolylinePosition {
  return positionAtDistance(polyline, ((speedKmH * 1000) / 3600) * elapsedSeconds);
}
