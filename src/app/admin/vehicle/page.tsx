import Link from "next/link";
import { adminListAssignments, adminListRoutes, normaliseVrn } from "@/lib/config-store";
import { getVisitSummary, suggestRoute, visitsText } from "@/lib/fleet-visits";
import { hasFleetSmartCredentials, knownPlaces, listFleetVehicles } from "@/lib/fleetsmart";
import { distanceMetres } from "@/lib/destination";
import { MAX_STOPS } from "@/lib/admin-validation";
import { placesFor, type Place } from "@/lib/routes";
import { gate } from "../gate";
import { VehicleEditor } from "../VehicleEditor";
import styles from "../admin.module.css";

type SearchParams = Promise<{ vrn?: string }>;

/** Add or edit one shuttle: its code and the stops it calls at. */
export default async function VehiclePage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await gate();
  if (blocked) return blocked;

  const vrn = normaliseVrn((await searchParams).vrn ?? "");
  if (!/^[A-Z0-9]{2,8}$/.test(vrn)) {
    return (
      <>
        <p className={styles.error}>Enter the registration as shown in FleetSmart (2–8 letters and numbers).</p>
        <Link href="/admin" className={styles.secondary}>
          Back to vehicles
        </Link>
      </>
    );
  }

  let assignments, routes;
  try {
    [assignments, routes] = await Promise.all([adminListAssignments(), adminListRoutes()]);
  } catch (error) {
    console.error("[admin]", error instanceof Error ? error.message : error);
    return <p className={styles.error}>Could not reach the database. Check DATABASE_URL and try again.</p>;
  }
  const existing = assignments.find((assignment) => assignment.vrn === vrn);

  // How FleetSmart writes the registration (spacing), if the vehicle is in the account.
  let registration = vrn;
  if (hasFleetSmartCredentials()) {
    try {
      registration = (await listFleetVehicles()).find((vehicle) => vehicle.vrn === vrn)?.registration ?? vrn;
    } catch {
      // The registration as typed is fine.
    }
  }

  // The stops to choose from are the places in the FleetSmart account; the built-in ones are
  // only offered when it has none (or can't be reached), and are still understood where already used.
  const all = await knownPlaces(routes);
  const fromFleetSmart = all.filter((place) => place.id.startsWith("poi-"));
  const options = fromFleetSmart.length > 0 ? fromFleetSmart : placesFor(routes);
  const names = Object.fromEntries(all.map((place) => [place.id, place.name]));
  const stopRoutes = stopRoutesOf(all, routes);
  const pickerNote =
    fromFleetSmart.length > 0
      ? `${fromFleetSmart.length === 1 ? "Your FleetSmart account has 1 place" : `Your FleetSmart account has ${fromFleetSmart.length} places`}. To add more stops, add them as places in FleetSmart.`
      : "No places were found in FleetSmart, so the built-in stops are offered.";
  // Where the vehicle has been lately (built in the background, so missing at first).
  const visits = getVisitSummary();
  const suggestion = visits ? suggestRoute(visits, routes, vrn) : null;
  const suggestedRoute = suggestion && routes.find((route) => route.id === suggestion.routeId);
  const recent = visits ? visitsText(visits, vrn) : "";
  const visitHint =
    suggestion && suggestedRoute
      ? `Suggested: Route ${suggestedRoute.id} · ${suggestedRoute.name}, from ${suggestion.visits} visits to ${suggestion.place} in the last ${visits!.days} days.`
      : recent
        ? `Recent visits: ${recent}. None of them is a route's station.`
        : visits
          ? `No visits to your places in the last ${visits.days} days.`
          : hasFleetSmartCredentials()
            ? "Looking up where this vehicle has been lately; reload in a minute for a route suggestion."
            : "";
  const routeOptions = routes.map((route) => ({ id: route.id, label: `Route ${route.id} · ${route.name}` }));

  return (
    <>
      <Link href="/admin" className={styles.back}>
        ← Vehicles
      </Link>
      <section className={styles.cardPlain}>
        <h2 className={styles.cardTitle}>{existing ? "Edit route" : "Add route"}</h2>
        <VehicleEditor
          vrn={vrn}
          registration={registration}
          initialCode={existing?.code ?? ""}
          initialStops={existing?.stops ?? []}
          existing={Boolean(existing)}
          places={options.map(({ id, name }) => ({ id, name }))}
          names={names}
          stopRoutes={stopRoutes}
          pickerNote={pickerNote}
          routes={routeOptions}
          initialRouteId={existing?.routeId ?? null}
          suggestedRouteId={suggestion?.routeId ?? null}
          visitHint={visitHint}
          maxStops={MAX_STOPS}
        />
      </section>
    </>
  );
}

/** The route each place belongs to: a route's own station, or a place right beside it. */
function stopRoutesOf(places: Place[], routes: { id: number; stationLocation: { lat: number; lng: number } }[]) {
  const result: Record<string, number> = {};
  for (const place of places) {
    if (place.routeId !== null) result[place.id] = place.routeId;
    else {
      const route = routes.find((r) => distanceMetres(place, r.stationLocation) <= STATION_MATCH_M);
      if (route) result[place.id] = route.id;
    }
  }
  return result;
}

/** A place is a route's station when it is this close to it. */
const STATION_MATCH_M = 250;
