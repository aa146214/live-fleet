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
const STUDIO_PREFIX = "Leavesden studio · ";

/** Leavesden studio (where the WB pin sits on the map). */
export const STUDIO_LOCATION: LatLng = { lat: 51.6906, lng: -0.418 };
/** ///goes.forget.lions; used to estimate whether a shuttle is heading to the studio. */
export const SOUTH_ENTRANCE_LOCATION: LatLng = { lat: 51.68640847347995, lng: -0.41707985386221297 };
export const NORTH_ENTRANCE_LOCATION: LatLng = { lat: 51.69244555843036, lng: -0.416383959638135 };

/**
 * The routes as shipped. The admin can edit each route's name, station and what3words
 * address (they are stored in the database); these are used until then, and when no
 * database is set up. The colour belongs to the design, so it is only set here.
 */
export const DEFAULT_ROUTES: ShuttleRoute[] = [
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
] as const;

/**
 * The built-in places (the studio's two entrances and the three stations), or a place set up in
 * the FleetSmart account (`poi-` and its id), which can only be a stop, not a map pin.
 */
export type PlaceId = "studio-north" | "studio-south" | "station-1" | "station-2" | "station-3" | `poi-${number}`;

/** Map pins: the studio's two entrances and each route's station. Tapping one shows its details. */
export interface Place extends LatLng {
  id: PlaceId;
  name: string;
  /** The station's route; null for the studio, which every route serves. */
  routeId: RouteId | null;
  /** For a studio pin, which of ENTRANCES it marks. */
  entrance?: (typeof ENTRANCES)[number]["name"];
}

export function placesFor(routes: ShuttleRoute[]): Place[] {
  return [
    {
      id: "studio-north",
      name: "Leavesden studio · North Entrance",
      routeId: null,
      entrance: "North Entrance",
      ...NORTH_ENTRANCE_LOCATION,
    },
    {
      id: "studio-south",
      name: "Leavesden studio · South Entrance",
      routeId: null,
      entrance: "South Entrance",
      ...SOUTH_ENTRANCE_LOCATION,
    },
    ...routes.map((route) => ({
      id: `station-${route.id}` as PlaceId,
      name: route.station,
      routeId: route.id,
      ...route.stationLocation,
    })),
  ];
}

export function getPlace(places: Place[], id: string | null): Place | undefined {
  return places.find((place) => place.id === id);
}

export function getRoute(routes: ShuttleRoute[], id: RouteId | null): ShuttleRoute | undefined {
  return routes.find((route) => route.id === id);
}

/** FleetSmart writes some place names in capitals; "WATFORD JUNCTION" reads better as "Watford Junction". */
export function tidyPlaceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 4 || trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toUpperCase());
}

/** A vehicle's route: the places it calls at, in order, then back to the first. */
export function defaultStops(route: ShuttleRoute): PlaceId[] {
  const station = `station-${route.id}` as PlaceId;
  return [station, "studio-south", "studio-north", station];
}

export function isPlaceId(value: string): value is PlaceId {
  return value === "studio-north" || value === "studio-south" || /^station-[1-3]$/.test(value) || /^poi-\d+$/.test(value);
}

/** How a stop is written in a route sequence: the station's route name, or the entrance. */
export function stopLabel(places: Place[], routes: ShuttleRoute[], id: string): string {
  const place = getPlace(places, id);
  if (!place) return id;
  return getRoute(routes, place.routeId)?.terminus ?? place.entrance ?? place.name;
}

/** e.g. "Watford Junction → South Entrance → North Entrance → Watford Junction" */
export function stopSequence(places: Place[], routes: ShuttleRoute[], stops: readonly string[]): string {
  return stops.map((id) => stopLabel(places, routes, id)).join(" → ");
}

/** The minibus's "next destination" text for a stop. */
export function destinationOf(place: Place, routes: ShuttleRoute[]): string {
  return getRoute(routes, place.routeId)?.station ?? place.name;
}

export function routeSequence(route: ShuttleRoute): string {
  return stopSequence(placesFor([route]), [route], defaultStops(route));
}

/** e.g. "Route 1 · Watford Station" */
export function routeSubtitle(route: ShuttleRoute): string {
  return `Route ${route.id} · ${route.name} Station`;
}

/** The details card shortens the studio stop to just the entrance. */
export function shortDestination(destination: string): string {
  return destination.startsWith(STUDIO_PREFIX) ? destination.slice(STUDIO_PREFIX.length) : destination;
}

/** How many of the given minibuses are assigned to each route (unassigned ones aren't counted). */
export function countByRoute(routes: ShuttleRoute[], vehicles: Vehicle[]): Map<RouteId, number> {
  const counts = new Map<RouteId, number>(routes.map((route) => [route.id, 0]));
  for (const vehicle of vehicles) {
    if (vehicle.routeId !== null) counts.set(vehicle.routeId, (counts.get(vehicle.routeId) ?? 0) + 1);
  }
  return counts;
}

/** The route's colour, which is fixed by the design, so it doesn't depend on the stored routes. */
export function routeColor(id: RouteId | null): string {
  return getRoute(DEFAULT_ROUTES, id)?.color ?? "var(--color-navy)";
}
