import { normaliseVrn, type RouteInput } from "./config-store";
import { isPlaceId, isRouteColour, type PlaceId } from "./routes";
import type { RouteId } from "./types";

/** Checks admin form input. Each returns the cleaned value, or an `error` to show. */
type Checked<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export const MAX_STOPS = 12;

/** A route as the editor sends it: a name, a short name, a colour and the stops in order. */
export function checkRoute(formData: FormData): Checked<RouteInput> {
  const name = text(formData, "name");
  if (!name || name.length > 60) return { error: "Give the route a name (up to 60 characters)." };
  const shortName = text(formData, "shortName");
  if (!shortName || shortName.length > 20) return { error: "Give the route a short name for the buttons (up to 20 characters)." };
  const colour = text(formData, "colour");
  if (!isRouteColour(colour)) return { error: "Choose a colour." };

  const stops = formData.getAll("stop").map(String);
  if (!stops.every(isPlaceId)) return { error: "One of the stops isn't a known place." };
  if (stops.length < 2) return { error: "Add at least two stops." };
  if (stops.length > MAX_STOPS) return { error: `A route has at most ${MAX_STOPS} stops.` };
  if (stops.some((stop, i) => stop === stops[i - 1])) return { error: "A stop can't follow itself; remove the repeat." };

  const id = text(formData, "id");
  return { value: { id: id ? Number(id) : undefined, name, shortName, colour, stops: stops as PlaceId[] } };
}

/** A minibus put on a route. The code shown on the map defaults to the number plate. */
export function checkAssignment(formData: FormData): Checked<{ vrn: string; code: string; routeId: RouteId }> {
  const vrn = normaliseVrn(text(formData, "vrn"));
  // FleetSmart has registrations with a hyphen (e.g. Z-W900), so those are allowed too.
  if (!/^[A-Z0-9-]{2,10}$/.test(vrn)) return { error: "That isn't a registration (2–10 letters, numbers and hyphens)." };
  const code = (text(formData, "code") || vrn).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{0,7}$/.test(code)) return { error: "The code is 1–8 letters or numbers." };
  const routeId = Number(text(formData, "routeId"));
  if (!Number.isInteger(routeId) || routeId < 1) return { error: "Choose a route." };
  return { value: { vrn, code, routeId } };
}
