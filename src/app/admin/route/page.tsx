import Link from "next/link";
import { adminListAssignments, adminListRoutes } from "@/lib/config-store";
import { MAX_STOPS } from "@/lib/admin-validation";
import { getVisitSummary, suggestRoute } from "@/lib/fleet-visits";
import { BUILT_IN_PLACES, type RouteColour } from "@/lib/routes";
import { hasFleetSmartCredentials, knownPlaces, listFleetVehicles, type FleetVehicle } from "@/lib/fleetsmart";
import { assignVehicleAction, unassignVehicleAction } from "../actions";
import { Flash } from "../Flash";
import { gate } from "../gate";
import { RouteEditor } from "../RouteEditor";
import { VehicleList, type VehicleListRow } from "../VehicleList";
import styles from "../admin.module.css";

type SearchParams = Promise<{ id?: string; notice?: string; error?: string }>;

/** Make a route, or change one: its name, colour and stops, and the minibuses on it. */
export default async function RoutePage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await gate();
  if (blocked) return blocked;

  const { id: idParam, notice, error } = await searchParams;
  const id = idParam === undefined ? undefined : Number(idParam);

  let assignments, routes;
  try {
    [assignments, routes] = await Promise.all([adminListAssignments(), adminListRoutes()]);
  } catch (error) {
    console.error("[admin]", error instanceof Error ? error.message : error);
    return <p className={styles.error}>Could not reach the database. Check DATABASE_URL and try again.</p>;
  }
  const route = id === undefined ? undefined : routes.find((candidate) => candidate.id === id);
  if (id !== undefined && !route) {
    return (
      <>
        <p className={styles.error}>That route doesn&apos;t exist (it may have been deleted).</p>
        <Link href="/admin" className={styles.secondary}>
          Back to routes
        </Link>
      </>
    );
  }

  // The stops to choose from are the places in the FleetSmart account; the built-in ones are only
  // offered when it has none (or can't be reached), and are still understood where already used.
  const all = await knownPlaces();
  const fromFleetSmart = all.filter((place) => place.id.startsWith("poi-"));
  const options = fromFleetSmart.length > 0 ? fromFleetSmart : BUILT_IN_PLACES;
  const names = Object.fromEntries(all.map((place) => [place.id, place.name]));
  const pickerNote =
    fromFleetSmart.length > 0
      ? `Your FleetSmart account has ${fromFleetSmart.length} place${fromFleetSmart.length === 1 ? "" : "s"}. To add more stops, add them as places in FleetSmart.`
      : "No places were found in FleetSmart, so the built-in stops are offered.";

  const onThisRoute = route ? assignments.filter((assignment) => assignment.routeId === route.id) : [];

  return (
    <>
      <Link href="/admin" className={styles.back}>
        ← Routes
      </Link>
      <Flash notice={notice} error={error} />
      <h2 className={styles.cardTitle}>{route ? route.name : "Create route"}</h2>
      <RouteEditor
        key={route?.id ?? "new"}
        id={route?.id}
        initial={{
          name: route?.name ?? "",
          shortName: route?.shortName ?? "",
          colour: (route?.colour ?? ROUTE_DEFAULT_COLOUR) as RouteColour,
          stops: route?.stops ?? [],
        }}
        places={options.map(({ id: placeId, name }) => ({ id: placeId, name }))}
        names={names}
        pickerNote={pickerNote}
        maxStops={MAX_STOPS}
        vehicleCount={onThisRoute.length}
      />
      {route ? (
        <Minibuses route={route} assignments={assignments} routes={routes} places={all} />
      ) : (
        <p className={styles.help}>Create the route first, then you can put minibuses on it.</p>
      )}
    </>
  );
}

const ROUTE_DEFAULT_COLOUR = "blue";

async function Minibuses({
  route,
  assignments,
  routes,
  places,
}: {
  route: NonNullable<Awaited<ReturnType<typeof adminListRoutes>>[number]>;
  assignments: Awaited<ReturnType<typeof adminListAssignments>>;
  routes: Awaited<ReturnType<typeof adminListRoutes>>;
  places: Awaited<ReturnType<typeof knownPlaces>>;
}) {
  const here = `/admin/route?id=${route.id}`;
  const onThisRoute = assignments.filter((assignment) => assignment.routeId === route.id);
  const elsewhere = new Map(assignments.filter((a) => a.routeId !== route.id).map((a) => [a.vrn, a]));
  const routeName = (routeId: number) => routes.find((r) => r.id === routeId)?.name ?? "another route";

  let fleet: FleetVehicle[] | null = null;
  let fleetProblem: string | null = null;
  if (hasFleetSmartCredentials()) {
    try {
      fleet = await listFleetVehicles();
    } catch (error) {
      console.error("[admin] FleetSmart:", error instanceof Error ? error.message : error);
      fleetProblem = "Could not load the vehicles from FleetSmart.";
    }
  } else {
    fleetProblem = "FleetSmart isn't connected, so there are no vehicles to list.";
  }
  const visits = getVisitSummary();
  const candidates = (fleet ?? []).filter((vehicle) => !onThisRoute.some((a) => a.vrn === vehicle.vrn));

  const addRows: VehicleListRow[] = candidates.map((vehicle) => {
    const suggestion = visits && suggestRoute(visits, routes, vehicle.vrn, places);
    const current = elsewhere.get(vehicle.vrn);
    return {
      key: vehicle.vrn,
      search: `${vehicle.registration} ${vehicle.vrn} ${vehicle.address}`,
      content: (
        <>
          <div className={styles.itemText}>
            <strong>{vehicle.registration}</strong>
            <p className={styles.help}>
              {current ? `Now on ${routeName(current.routeId)} (${current.code})` : `${vehicle.distanceKm.toFixed(1)} km from the studio`}
              {vehicle.address ? ` · ${vehicle.address}` : ""}
            </p>
            {suggestion?.routeId === route.id && (
              <p className={styles.suggestion}>
                Suggested for this route ({suggestion.visits} visits to {suggestion.place} in the last {visits!.days} days)
              </p>
            )}
          </div>
          <form action={assignVehicleAction}>
            <input type="hidden" name="vrn" value={vehicle.vrn} />
            <input type="hidden" name="routeId" value={route.id} />
            <input type="hidden" name="returnTo" value={here} />
            {current && <input type="hidden" name="code" value={current.code} />}
            <button type="submit" className={current ? styles.secondary : styles.primary}>
              {current ? "Move here" : "Add"}
            </button>
          </form>
        </>
      ),
    };
  });

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Minibuses on this route</h2>
        {onThisRoute.length === 0 ? (
          <p className={styles.help}>None yet. Add some below: only minibuses on a route are shown on the map.</p>
        ) : (
          <ul className={styles.list}>
            {onThisRoute.map((assignment) => (
              <li key={assignment.vrn} className={styles.item}>
                <form action={assignVehicleAction} className={styles.assignRow}>
                  <input type="hidden" name="vrn" value={assignment.vrn} />
                  <input type="hidden" name="routeId" value={route.id} />
                  <input type="hidden" name="returnTo" value={here} />
                  <div className={styles.itemText}>
                    <strong>{assignment.vrn}</strong>
                    <p className={styles.help}>Code on the map</p>
                  </div>
                  <input
                    name="code"
                    defaultValue={assignment.code}
                    aria-label={`Code on the map for ${assignment.vrn}`}
                    maxLength={8}
                    className={styles.codeInput}
                  />
                  <button type="submit" className={styles.secondary}>
                    Save code
                  </button>
                  <button type="submit" formAction={unassignVehicleAction} formNoValidate className={styles.danger}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Add minibuses</h2>
        {fleetProblem && <p className={styles.help}>{fleetProblem}</p>}
        {candidates.length > 0 && (
          <>
            <p className={styles.help}>
              From your FleetSmart account, nearest the studio first. The code shown on the map is the number plate
              unless you change it above.
            </p>
            <VehicleList label="vehicles" rows={addRows} />
          </>
        )}
      </section>
    </>
  );
}
