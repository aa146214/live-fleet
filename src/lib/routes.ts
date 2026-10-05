import type { RouteId, Vehicle } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ShuttleRoute {
  id: RouteId;
  name: string;
  /** CSS custom property holding the route colour. */
  color: string;
  station: string;
  /** How the station is written inside the route sequence. */
  terminus: string;
  what3words: string;
  stationLocation: LatLng;
}

/** Where shuttles drop off at the studio; the first stop after leaving a station. */
export const STUDIO_DESTINATION = "Leavesden studio · South Entrance";
export const STUDIO_DESTINATION_SHORT = "South Entrance";

/** Leavesden studio (where the WB pin sits on the map). */
export const STUDIO_LOCATION: LatLng = { lat: 51.6906, lng: -0.418 };
/** ///goes.forget.lions; used to estimate whether a shuttle is heading to the studio. */
export const SOUTH_ENTRANCE_LOCATION: LatLng = { lat: 51.686408, lng: -0.417123 };

export const ROUTES: ShuttleRoute[] = [
  {
    id: 1,
    name: "Watford",
    color: "var(--color-blue)",
    station: "Watford Junction station",
    terminus: "Watford Junction",
    what3words: "///hired.boat.speaks",
    stationLocation: { lat: 51.6635, lng: -0.3963 },
  },
  {
    id: 2,
    name: "St Albans",
    color: "var(--color-black)",
    station: "St Albans station",
    terminus: "St Albans station",
    what3words: "///soup.moral.easy",
    stationLocation: { lat: 51.7503, lng: -0.3276 },
  },
  {
    id: 3,
    name: "Rickmansworth",
    color: "var(--color-green)",
    station: "Rickmansworth station",
    terminus: "Rickmansworth station",
    what3words: "///trim.lied.tops",
    stationLocation: { lat: 51.6402, lng: -0.4732 },
  },
];

export const ENTRANCES = [
  { name: "North Entrance", detail: "Warner Drive, WD25 7LP" },
  { name: "South Entrance", detail: "///goes.forget.lions" },
];

export type PlaceId = "studio" | "station-1" | "station-2" | "station-3";

/** Map pins: the studio and each route's station. Tapping one shows its details. */
export interface Place extends LatLng {
  id: PlaceId;
  name: string;
  /** The station's route; null for the studio, which every route serves. */
  routeId: RouteId | null;
}

export const PLACES: Place[] = [
  { id: "studio", name: "Leavesden studio", routeId: null, ...STUDIO_LOCATION },
  ...ROUTES.map((route) => ({
    id: `station-${route.id}` as PlaceId,
    name: route.station,
    routeId: route.id,
    ...route.stationLocation,
  })),
];

export function getPlace(id: string | null): Place | undefined {
  return PLACES.find((place) => place.id === id);
}

export function getRoute(id: RouteId | null): ShuttleRoute | undefined {
  return ROUTES.find((route) => route.id === id);
}

export function routeSequence(route: ShuttleRoute): string {
  return `${route.terminus} → South Entrance → North Entrance → ${route.terminus}`;
}

/** e.g. "Route 1 · Watford Station" */
export function routeSubtitle(route: ShuttleRoute): string {
  return `Route ${route.id} · ${route.name} Station`;
}

/** The details card shortens the studio stop to just the entrance. */
export function shortDestination(destination: string): string {
  return destination === STUDIO_DESTINATION ? STUDIO_DESTINATION_SHORT : destination;
}

/** How many of the given minibuses are assigned to each route (unassigned ones aren't counted). */
export function countByRoute(vehicles: Vehicle[]): Map<RouteId, number> {
  const counts = new Map<RouteId, number>(ROUTES.map((route) => [route.id, 0]));
  for (const vehicle of vehicles) {
    if (vehicle.routeId !== null) counts.set(vehicle.routeId, (counts.get(vehicle.routeId) ?? 0) + 1);
  }
  return counts;
}

export function routeColor(id: RouteId | null): string {
  return getRoute(id)?.color ?? "var(--color-navy)";
}
