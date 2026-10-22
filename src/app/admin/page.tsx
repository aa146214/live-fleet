import Link from "next/link";
import { adminListAssignments, adminListRoutes } from "@/lib/config-store";
import { getVisitSummary, suggestRoute, visitsText } from "@/lib/fleet-visits";
import { hasFleetSmartCredentials, knownPlaces, listFleetVehicles, type FleetVehicle } from "@/lib/fleetsmart";
import { stopSequence } from "@/lib/routes";
import { assignVehicleAction } from "./actions";
import { Flash } from "./Flash";
import { gate } from "./gate";
import { VehicleList, type VehicleListRow } from "./VehicleList";
import styles from "./admin.module.css";

type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const { notice, error } = await searchParams;
  const blocked = await gate();

  return (
    <>
      <Flash notice={notice} error={error} />
      {blocked ?? <Home />}
    </>
  );
}

async function Home() {
  let assignments, routes;
  try {
    [assignments, routes] = await Promise.all([adminListAssignments(), adminListRoutes()]);
  } catch (error) {
    const cause =
      error instanceof Error ? (error.cause ?? (error as { sourceError?: unknown }).sourceError) : undefined;
    console.error("[admin]", error instanceof Error ? error.message : error, cause ?? "");
    return <p className={styles.error}>Could not reach the database. Check DATABASE_URL and try again.</p>;
  }

  // The account's vehicles, to put on routes.
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

  const places = await knownPlaces();
  // Recent visits to the places in FleetSmart; built in the background, so missing at first.
  const visits = getVisitSummary();
  const onRoute = new Set(assignments.map((assignment) => assignment.vrn));
  const others = (fleet ?? []).filter((vehicle) => !onRoute.has(vehicle.vrn));

  const otherRows: VehicleListRow[] = others.map((vehicle) => {
    const suggestion = visits && suggestRoute(visits, routes, vehicle.vrn, places);
    const suggested = suggestion && routes.find((r) => r.id === suggestion.routeId);
    const seen = visits ? visitsText(visits, vehicle.vrn) : "";
    return {
      key: vehicle.vrn,
      search: `${vehicle.registration} ${vehicle.vrn} ${vehicle.address}`,
      content: (
        <>
          <div className={styles.itemText}>
            <strong>{vehicle.registration}</strong>
            <p className={styles.help}>
              {vehicle.distanceKm.toFixed(1)} km from the studio{vehicle.isMinibus ? " · minibus" : ""}
              {vehicle.address ? ` · ${vehicle.address}` : ""}
            </p>
            {suggestion && suggested && (
              <p className={styles.suggestion}>
                Suggested: {suggested.name} ({suggestion.visits} visits to {suggestion.place} in the last{" "}
                {visits!.days} days)
              </p>
            )}
            {!suggestion && seen && <p className={styles.help}>Recent visits: {seen}</p>}
          </div>
          {routes.length > 0 && (
            <form action={assignVehicleAction} className={styles.assignRow}>
              <input type="hidden" name="vrn" value={vehicle.vrn} />
              <input type="hidden" name="returnTo" value="/admin" />
              <select name="routeId" defaultValue={suggested?.id ?? routes[0].id} aria-label={`Route for ${vehicle.registration}`}>
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.shortName}
                  </option>
                ))}
              </select>
              <button type="submit" className={styles.primary}>
                Add to route
              </button>
            </form>
          )}
        </>
      ),
    };
  });

  return (
    <>
      <section className={styles.card}>
        <div className={styles.headingRow}>
          <h2 className={styles.cardTitle}>Routes</h2>
          <Link href="/admin/route" className={styles.primary}>
            Create route
          </Link>
        </div>
        {routes.length === 0 ? (
          <p className={styles.help}>No routes yet. Create a route, then put minibuses on it.</p>
        ) : (
          <div>
            {routes.map((route) => {
              const vehicles = assignments.filter((assignment) => assignment.routeId === route.id);
              return (
                <div key={route.id} className={styles.routeCard}>
                  <span className={styles.dot} style={{ background: route.color }} aria-hidden="true" />
                  <div className={styles.itemText}>
                    <strong>{route.name}</strong> <span className={styles.vrn}>{route.shortName}</span>
                    <p className={styles.help}>{stopSequence(places, route.stops)}</p>
                    <p className={styles.help}>
                      {vehicles.length === 0
                        ? "No minibuses yet"
                        : `${vehicles.length} minibus${vehicles.length === 1 ? "" : "es"}: ${vehicles.map((v) => v.code).join(", ")}`}
                    </p>
                  </div>
                  <Link href={`/admin/route?id=${route.id}`} className={styles.secondary}>
                    Edit
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Minibuses not on a route</h2>
        {fleetProblem && <p className={styles.help}>{fleetProblem}</p>}
        {others.length > 0 && (
          <>
            <p className={styles.help}>
              From your FleetSmart account, nearest the studio first. Only minibuses on a route are shown on the map.
              {hasFleetSmartCredentials() && !visits
                ? " Looking up where each has been lately to suggest routes; reload in a minute."
                : ""}
            </p>
            {routes.length === 0 && <p className={styles.help}>Create a route first, then add minibuses to it here.</p>}
            <VehicleList label="vehicles" rows={otherRows} />
          </>
        )}
      </section>
    </>
  );
}
