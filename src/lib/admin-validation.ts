import { normaliseVrn } from "./config-store";
import { isPlaceId, type PlaceId } from "./routes";
import type { RouteId } from "./types";

/** Checks admin form input. Each returns the cleaned value, or an `error` to show. */
type Checked<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export const MAX_STOPS = 12;

/** The routes' stops from the editor, in order. */
export function checkVehicle(
  formData: FormData,
): Checked<{ vrn: string; code: string; routeId: RouteId; stops: PlaceId[] }> {
  const vrn = normaliseVrn(text(formData, "vrn"));
  if (!/^[A-Z0-9]{2,8}$/.test(vrn)) return { error: "Enter the registration as shown in FleetSmart (2–8 letters and numbers)." };

  const code = text(formData, "code").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{0,7}$/.test(code)) return { error: "The code is 1–8 letters or numbers, e.g. W1." };

  const stops = formData.getAll("stop").map(String);
  if (!stops.every(isPlaceId)) return { error: "One of the stops isn't a known place." };
  if (stops.length < 2) return { error: "Add at least two stops." };
  if (stops.length > MAX_STOPS) return { error: `A route has at most ${MAX_STOPS} stops.` };
  if (stops.some((stop, i) => stop === stops[i - 1])) return { error: "A stop can't follow itself; remove the repeat." };

  // The route sets the shuttle's colour and its group on the map; it is chosen, not worked out from the stops.
  const routeId = Number(text(formData, "routeId"));
  if (![1, 2, 3].includes(routeId)) return { error: "Choose a route." };

  return { value: { vrn, code, routeId: routeId as RouteId, stops: stops as PlaceId[] } };
}
