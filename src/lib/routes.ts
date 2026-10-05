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

export const STUDIO_DESTINATION = "Leavesden studio · Gate B";

// Gate A/B positions still need confirming, so both gates use the studio location.
export const STUDIO_LOCATION: LatLng = { lat: 51.6906, lng: -0.418 };

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

export const POINTS_OF_INTEREST: Array<{ name: string } & LatLng> = [
  { name: "Leavesden studio", ...STUDIO_LOCATION },
  { name: "St Albans station", ...ROUTES[1].stationLocation },
  { name: "Watford Junction", ...ROUTES[0].stationLocation },
  { name: "Rickmansworth station", ...ROUTES[2].stationLocation },
];

export function getRoute(id: RouteId | null): ShuttleRoute | undefined {
  return ROUTES.find((route) => route.id === id);
}

export function routeSequence(route: ShuttleRoute): string {
  return `${route.terminus} → Gate B → Gate A → ${route.terminus}`;
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
