import type { RouteId, Vehicle } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

/** The colours a route can have: the design's palette, each dark enough for white text. */
export const ROUTE_COLOURS = [
  { key: "blue", label: "Blue", value: "var(--color-blue)" },
  { key: "black", label: "Black", value: "var(--color-black)" },
  { key: "green", label: "Green", value: "var(--color-green)" },
  { key: "purple", label: "Purple", value: "var(--color-purple)" },
  { key: "orange", label: "Orange", value: "var(--color-orange)" },
  { key: "red", label: "Red", value: "var(--color-red)" },
  { key: "teal", label: "Teal", value: "var(--color-teal)" },
  { key: "pink", label: "Pink", value: "var(--color-pink)" },
] as const;

export type RouteColour = (typeof ROUTE_COLOURS)[number]["key"];

export const isRouteColour = (value: string): value is RouteColour => ROUTE_COLOURS.some((c) => c.key === value);

export interface ShuttleRoute {
  id: RouteId;
  /** The full name, e.g. "Watford Junction Train Station". */
  name: string;
  /** A short form for tight spaces (the route buttons in the header), e.g. "Watford". */
  shortName: string;
  /** The colour's key in ROUTE_COLOURS. */
  colour: RouteColour;
  /** The CSS colour for `colour` (e.g. "var(--color-blue)"). */
  color: string;
  /** The places the route calls at, in order; it returns to the first after the last. */
  stops: PlaceId[];
}

export function makeRoute(route: Omit<ShuttleRoute, "color">): ShuttleRoute {
  return { ...route, color: ROUTE_COLOURS.find((c) => c.key === route.colour)?.value ?? "var(--color-navy)" };
}

/** Where shuttles drop off at the studio; the first stop after leaving a station. */
export const STUDIO_DESTINATION = "WBSL South Entrance";

/** Leavesden studio (where the WB pin sits on the map). */
export const STUDIO_LOCATION: LatLng = { lat: 51.6906, lng: -0.418 };
/** ///goes.forget.lions */
export const SOUTH_ENTRANCE_LOCATION: LatLng = { lat: 51.68640847347995, lng: -0.41707985386221297 };
export const NORTH_ENTRANCE_LOCATION: LatLng = { lat: 51.69244555843036, lng: -0.416383959638135 };

/**
 * The built-in places (the studio's two entrances and the three stations), or a place set up in
 * the FleetSmart account (`poi-` and its id).
 */
export type PlaceId = "studio-north" | "studio-south" | "station-1" | "station-2" | "station-3" | `poi-${number}`;

/** A studio gets the Warner Bros. shield for its pin, a station the coloured station pin. */
export type PlaceKind = "studio" | "station";

export interface Place extends LatLng {
  id: PlaceId;
  name: string;
  kind: PlaceKind;
  what3words?: string;
  address?: string;
}

/** The kind of a place set up in FleetSmart, from its name (the WBSL entrances are the studio). */
export const placeKindOf = (name: string): PlaceKind => (/\bwbsl\b|\bstudios?\b/i.test(name) ? "studio" : "station");

export const BUILT_IN_PLACES: Place[] = [
  { id: "studio-north", name: "WBSL North Entrance", kind: "studio", address: "Warner Drive, WD25 7LP", ...NORTH_ENTRANCE_LOCATION },
  { id: "studio-south", name: "WBSL South Entrance", kind: "studio", what3words: "///goes.forget.lions", ...SOUTH_ENTRANCE_LOCATION },
  { id: "station-1", name: "Watford Junction Train Station", kind: "station", what3words: "///hired.boat.speaks", lat: 51.6635, lng: -0.3963 },
  { id: "station-2", name: "St Albans City Train Station", kind: "station", what3words: "///soup.moral.easy", lat: 51.7503, lng: -0.3276 },
  { id: "station-3", name: "Rickmansworth Train Station", kind: "station", what3words: "///trim.lied.tops", lat: 51.6402, lng: -0.4732 },
];

/**
 * The routes as shipped: used when there is no database, and for the demo. With a database the
 * routes are the ones the admin makes (the first time, these three are stored as a start).
 */
export const DEFAULT_ROUTES: ShuttleRoute[] = [
  makeRoute({
    id: 1,
    name: "Watford Junction Train Station",
    shortName: "Watford",
    colour: "blue",
    stops: ["station-1", "studio-south", "studio-north", "station-1"],
  }),
  makeRoute({
    id: 2,
    name: "St Albans City Train Station",
    shortName: "St Albans",
    colour: "black",
    stops: ["station-2", "studio-south", "studio-north", "station-2"],
  }),
  makeRoute({
    id: 3,
    name: "Rickmansworth Train Station",
    shortName: "Rickmansworth",
    colour: "green",
    stops: ["station-3", "studio-south", "studio-north", "station-3"],
  }),
];

/** A place that is a stop on at least one route, as drawn on the map. */
export interface PinPlace extends Place {
  /** The routes that call here. */
  routeIds: RouteId[];
}

/** The places the routes call at (each once), for the map's pins. */
export function pinPlacesFor(routes: ShuttleRoute[], known: Place[]): PinPlace[] {
  const pins = new Map<string, PinPlace>();
  for (const route of routes) {
    for (const id of route.stops) {
      const existing = pins.get(id);
      if (existing) {
        if (!existing.routeIds.includes(route.id)) existing.routeIds.push(route.id);
        continue;
      }
      const place = known.find((candidate) => candidate.id === id);
      if (place) pins.set(id, { ...place, routeIds: [route.id] });
    }
  }
  return [...pins.values()];
}

export function getPlace<T extends Place>(places: T[], id: string | null): T | undefined {
  return places.find((place) => place.id === id);
}

export function getRoute(routes: ShuttleRoute[], id: RouteId | null): ShuttleRoute | undefined {
  return routes.find((route) => route.id === id);
}

/** Words that stay in capitals when a name FleetSmart wrote in capitals is tidied. */
const ACRONYMS = new Set(["WBSL", "WB"]);

/** FleetSmart writes some place names in capitals; "WATFORD JUNCTION" reads better as "Watford Junction". */
export function tidyPlaceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 4 || trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((word) => (ACRONYMS.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(" ");
}

export function isPlaceId(value: string): value is PlaceId {
  return value === "studio-north" || value === "studio-south" || /^station-[1-3]$/.test(value) || /^poi-\d+$/.test(value);
}

/** How a stop is written in a route sequence: the place's name (e.g. WBSL South Entrance). */
export function stopLabel(places: Place[], id: string): string {
  return getPlace(places, id)?.name ?? id;
}

/** e.g. "Watford Junction Train Station → WBSL South Entrance → WBSL North Entrance → Watford Junction Train Station" */
export function stopSequence(places: Place[], stops: readonly string[]): string {
  return stops.map((id) => stopLabel(places, id)).join(" → ");
}

/** How many of the given minibuses are assigned to each route (unassigned ones aren't counted). */
export function countByRoute(routes: ShuttleRoute[], vehicles: Vehicle[]): Map<RouteId, number> {
  const counts = new Map<RouteId, number>(routes.map((route) => [route.id, 0]));
  for (const vehicle of vehicles) {
    if (vehicle.routeId !== null) counts.set(vehicle.routeId, (counts.get(vehicle.routeId) ?? 0) + 1);
  }
  return counts;
}

/** The route's colour (navy for a minibus with no route). */
export function routeColor(routes: ShuttleRoute[], id: RouteId | null): string {
  return getRoute(routes, id)?.color ?? "var(--color-navy)";
}
