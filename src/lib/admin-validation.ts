import { isBannerColour, londonInputToIso, MAX_BANNER_MESSAGE, type BannerInput } from "./banners";
import { normaliseVrn, type RouteInput } from "./config-store";
import { isPlaceId, isRouteColour, type LatLng, type PlaceId } from "./routes";
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

/** A news banner: a message, a colour, on or off, and when it shows (UK time; either end can be left empty). */
export function checkBanner(formData: FormData): Checked<BannerInput> {
  const message = text(formData, "message");
  if (!message || message.length > MAX_BANNER_MESSAGE) {
    return { error: `Write the message (up to ${MAX_BANNER_MESSAGE} characters).` };
  }
  const colour = text(formData, "colour");
  if (!isBannerColour(colour)) return { error: "Choose a colour." };
  const link = text(formData, "link");
  if (link && (link.length > 300 || !/^https?:\/\/\S+$/i.test(link))) {
    return { error: "The link must start with http:// or https://." };
  }

  const startText = text(formData, "startsAt");
  const endText = text(formData, "endsAt");
  const startsAt = startText ? londonInputToIso(startText) : null;
  const endsAt = endText ? londonInputToIso(endText) : null;
  if ((startText && !startsAt) || (endText && !endsAt)) return { error: "That isn't a valid date and time." };
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return { error: "The end must be after the start." };

  const id = text(formData, "id");
  return { value: { id: id ? Number(id) : undefined, message, colour, link, active: formData.get("active") === "on", startsAt, endsAt } };
}

/** "51.6630, -0.3958" (as copied from a map) as a position; null if it isn't one, or isn't near the UK. */
export function parseLatLng(value: string): LatLng | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return lat >= 49 && lat <= 61 && lng >= -9 && lng <= 3 ? { lat, lng } : null;
}

/** A pin's new position: the place, and "latitude, longitude". */
export function checkMarker(formData: FormData): Checked<{ placeId: PlaceId; position: LatLng }> {
  const placeId = text(formData, "placeId");
  if (!isPlaceId(placeId)) return { error: "That isn't a known place." };
  const position = parseLatLng(text(formData, "position"));
  if (!position) return { error: "Enter the position as latitude, longitude (e.g. 51.6630, -0.3958), in the UK." };
  return { value: { placeId, position } };
}
