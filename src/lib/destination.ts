import type { LatLng } from "./routes";
import type { VehicleStatus } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(from: LatLng, to: LatLng): number {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleBetween(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** A stop of a route, for guessing where a minibus is heading. */
export interface StopPoint {
  name: string;
  location: LatLng;
}

/**
 * FleetSmart has no timetable data, so until the road through the stops is known (route-loops.ts
 * then says exactly) the next stop is estimated: of the route's stops, the one the minibus is
 * heading towards. A stationary minibus is assumed to leave for the farthest one.
 */
export function estimateNextDestination(
  position: LatLng,
  stops: StopPoint[] | undefined,
  heading: number | null,
  status: VehicleStatus,
): string {
  if (!stops || stops.length === 0) return "Not on a shuttle route";
  const ends = stops.filter((stop, i) => stops.findIndex((other) => other.name === stop.name) === i);

  if (status === "moving" && heading !== null) {
    const [best] = [...ends].sort(
      (a, b) =>
        angleBetween(heading, bearingDegrees(position, a.location)) -
          angleBetween(heading, bearingDegrees(position, b.location)) ||
        distanceMetres(position, a.location) - distanceMetres(position, b.location),
    );
    return best.name;
  }

  const [farthest] = [...ends].sort(
    (a, b) => distanceMetres(position, b.location) - distanceMetres(position, a.location),
  );
  return farthest.name;
}
