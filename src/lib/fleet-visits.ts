import { after } from "next/server";
import { distanceMetres } from "./destination";
import { fleetSmartGet, hasFleetSmartCredentials, type Resource } from "./fleetsmart";
import type { ShuttleRoute } from "./routes";
import type { RouteId } from "./types";

/**
 * Which places each vehicle has visited lately, from FleetSmart's place events
 * (`poi_events`: a vehicle entering and leaving a place set up in the account). A shuttle
 * that keeps visiting a route's station is probably on that route, which the admin
 * offers as a suggestion. Server only.
 */

/** How far back to look. */
const DAYS = 14;
const MAX_PAGES = 30;
const PAGE_SIZE = 100;
const PAGE_GAP_MS = 1100;
/** The summary is rebuilt when older than this; a failed attempt is retried after RETRY_MS. */
const FRESH_MS = 30 * 60_000;
const RETRY_MS = 60_000;

/** A place counts as a route's station when it is this close to it. */
const STATION_MATCH_M = 250;
/** Fewer visits than this in the period isn't a pattern. */
const MIN_VISITS = 3;

export interface VisitPlace {
  name: string;
  lat: number;
  lng: number;
}

export interface VisitSummary {
  days: number;
  places: VisitPlace[];
  /** Visits by registration (no spaces, upper case), then by place name. */
  visits: Map<string, Map<string, number>>;
}

let cached: { at: number; summary: VisitSummary } | undefined;
let inFlight: Promise<void> | undefined;
let failedAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalise = (vrn: string) => vrn.replace(/\s+/g, "").toUpperCase();

async function build(): Promise<VisitSummary> {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60_000).toISOString();
  const vehicles = new Map<string, string>();
  const placesById = new Map<string, VisitPlace>();
  const visits = new Map<string, Map<string, number>>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAGE_GAP_MS);
    // Newest first, so the walk back stops once it reaches events older than DAYS.
    const params = new URLSearchParams({
      include: "vehicle,poi,entry_event",
      "page[size]": String(PAGE_SIZE),
      "page[number]": String(page),
      sort: "-id",
    });
    // The live map polls the same API, so a request can be turned away; one more try is enough.
    const doc = await fleetSmartGet("/poi_events", params).catch(async () => {
      await sleep(2500);
      return fleetSmartGet("/poi_events", params);
    });
    const times = new Map<string, string>();
    for (const resource of doc.included ?? []) {
      const attributes = (resource as Resource).attributes;
      if (resource.type === "vehicles") vehicles.set(resource.id, normalise(String(attributes.vrn ?? "")));
      if (resource.type === "vehicle_locations") times.set(resource.id, String(attributes.date_time ?? ""));
      if (resource.type === "pois") {
        const lat = Number(attributes.lat);
        const lng = Number(attributes.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          placesById.set(resource.id, { name: String(attributes.name ?? ""), lat, lng });
        }
      }
    }

    let reachedOlder = false;
    for (const event of doc.data) {
      const entry = event.relationships?.entry_event?.data;
      const at = entry ? times.get(entry.id) : undefined;
      if (at && at < since) {
        reachedOlder = true;
        continue;
      }
      const vrn = vehicles.get(event.relationships?.vehicle?.data?.id ?? "");
      const place = placesById.get(event.relationships?.poi?.data?.id ?? "");
      if (!vrn || !place) continue;
      const byPlace = visits.get(vrn) ?? new Map<string, number>();
      byPlace.set(place.name, (byPlace.get(place.name) ?? 0) + 1);
      visits.set(vrn, byPlace);
    }
    if (reachedOlder || doc.data.length < PAGE_SIZE) break;
  }
  return { days: DAYS, places: [...placesById.values()], visits };
}

/**
 * The recent-visits summary, or undefined while it is being built (a minute or so the
 * first time, because FleetSmart allows one request a second). Building carries on after
 * the page has been sent, so a reload a little later has it.
 */
export function getVisitSummary(): VisitSummary | undefined {
  if (!hasFleetSmartCredentials()) return undefined;
  const stale = !cached || Date.now() - cached.at > FRESH_MS;
  if (stale && !inFlight && Date.now() - failedAt > RETRY_MS) {
    inFlight = build()
      .then((summary) => {
        cached = { at: Date.now(), summary };
      })
      .catch((error) => {
        failedAt = Date.now();
        console.error("[visits]", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        inFlight = undefined;
      });
    // On serverless hosting, keeps the work going after the response.
    after(() => inFlight);
  }
  return cached?.summary;
}

export interface RouteSuggestion {
  routeId: RouteId;
  place: string;
  visits: number;
}

/** The route whose station the vehicle has visited most, if it is a pattern. */
export function suggestRoute(summary: VisitSummary, routes: ShuttleRoute[], vrn: string): RouteSuggestion | null {
  const byPlace = summary.visits.get(normalise(vrn));
  if (!byPlace) return null;
  let best: RouteSuggestion | null = null;
  for (const route of routes) {
    for (const place of summary.places) {
      if (distanceMetres(place, route.stationLocation) > STATION_MATCH_M) continue;
      const count = byPlace.get(place.name) ?? 0;
      if (count >= MIN_VISITS && (!best || count > best.visits)) best = { routeId: route.id, place: place.name, visits: count };
    }
  }
  return best;
}

/** e.g. "WBSL 107 · Watford Junction 97", most visited first. */
export function visitsText(summary: VisitSummary, vrn: string): string {
  const byPlace = summary.visits.get(normalise(vrn));
  if (!byPlace) return "";
  return [...byPlace].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(" · ");
}
