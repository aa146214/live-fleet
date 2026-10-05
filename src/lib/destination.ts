import { getRoute, SOUTH_ENTRANCE_LOCATION, STUDIO_DESTINATION, type LatLng } from "./routes";
import type { RouteId, VehicleStatus } from "./types";

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

/**
 * FleetSmart has no timetable data, so the next stop is estimated: a shuttle
 * only runs between its station and the studio, so pick whichever end it is
 * heading towards. A stationary shuttle is assumed to leave for the far end.
 */
export function estimateNextDestination(
  position: LatLng,
  routeId: RouteId | null,
  heading: number | null,
  status: VehicleStatus,
): string {
  const route = getRoute(routeId);
  if (!route) return "Not on a shuttle route";

  const ends = [
    { name: STUDIO_DESTINATION, location: SOUTH_ENTRANCE_LOCATION },
    { name: route.station, location: route.stationLocation },
  ];

  if (status === "moving" && heading !== null) {
    const [best] = [...ends].sort(
      (a, b) =>
        angleBetween(heading, bearingDegrees(position, a.location)) -
        angleBetween(heading, bearingDegrees(position, b.location)),
    );
    return best.name;
  }

  const [farthest] = [...ends].sort(
    (a, b) => distanceMetres(position, b.location) - distanceMetres(position, a.location),
  );
  return farthest.name;
}
