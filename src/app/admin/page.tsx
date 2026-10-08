import Link from "next/link";
import { adminListAssignments, adminListRoutes } from "@/lib/config-store";
import { getVisitSummary, suggestRoute, visitsText } from "@/lib/fleet-visits";
import { hasFleetSmartCredentials, knownPlaces, listFleetVehicles, type FleetVehicle } from "@/lib/fleetsmart";
import { stopSequence } from "@/lib/routes";
import { gate } from "./gate";
import styles from "./admin.module.css";

type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const { notice, error } = await searchParams;
  const blocked = await gate();

  return (
    <>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {blocked ?? <Vehicles />}
    </>
  );
}

async function Vehicles() {
  let assignments, routes;
  try {
    [assignments, routes] = await Promise.all([adminListAssignments(), adminListRoutes()]);
  } catch (error) {
    const cause =
      error instanceof Error ? (error.cause ?? (error as { sourceError?: unknown }).sourceError) : undefined;
    console.error("[admin]", error instanceof Error ? error.message : error, cause ?? "");
    return <p className={styles.error}>Could not reach the database. Check DATABASE_URL and try again.</p>;
  }

  // The account's vehicles, to pick the next shuttle from.
  let fleet: FleetVehicle[] | null = null;
  let fleetProblem: string | null = null;
  if (hasFleetSmartCredentials()) {
    try {
      fleet = await listFleetVehicles();
    } catch (error) {
      console.error("[admin] FleetSmart:", error instanceof Error ? error.message : error);
      fleetProblem = "Could not load the vehicles from FleetSmart. ";
    }
  } else {
    fleetProblem = "FleetSmart isn't connected, so there are no vehicles to list.";
  }

  const places = await knownPlaces(routes);
  // Recent visits to the places in FleetSmart; built in the background, so missing at first.
  const visits = getVisitSummary();
  const assigned = new Set(assignments.map((assignment) => assignment.vrn));
  const others = (fleet ?? []).filter((vehicle) => !assigned.has(vehicle.vrn));
  const inFleet = new Set((fleet ?? []).map((vehicle) => vehicle.vrn));

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Shuttles</h2>
        {assignments.length === 0 ? (
          <p className={styles.help}>
            No shuttles yet. The map shows the minibuses near the studio, labelled by registration; add a route to one
            below to make it a shuttle.
          </p>
        ) : (
          <ul className={styles.list}>
            {assignments.map((assignment) => (
              <li key={assignment.vrn} className={styles.item}>
                <div className={styles.itemText}>
                  <strong>{assignment.code}</strong> <span className={styles.vrn}>{assignment.vrn}</span>
                  {fleet && !inFleet.has(assignment.vrn) && (
                    <span className={styles.missing}> · not in FleetSmart</span>
                  )}
                  <p className={styles.help}>{stopSequence(places, routes, assignment.stops)}</p>
                </div>
                <Link href={`/admin/vehicle?vrn=${encodeURIComponent(assignment.vrn)}`} className={styles.secondary}>
                  Edit route
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Other vehicles</h2>
        {fleetProblem && <p className={styles.help}>{fleetProblem}</p>}
        {others.length > 0 && (
          <>
            <p className={styles.help}>
              From your FleetSmart account, nearest the studio first.
              {hasFleetSmartCredentials() && !visits
                ? " Looking up where each has been lately to suggest routes; reload in a minute."
                : ""}
            </p>
            <ul className={styles.list}>
              {others.map((vehicle) => {
                const suggestion = visits && suggestRoute(visits, routes, vehicle.vrn);
                const route = suggestion && routes.find((r) => r.id === suggestion.routeId);
                const seen = visits ? visitsText(visits, vehicle.vrn) : "";
                return (
                  <li key={vehicle.vrn} className={styles.item}>
                    <div className={styles.itemText}>
                      <strong>{vehicle.registration}</strong>
                      <p className={styles.help}>
                        {vehicle.distanceKm.toFixed(1)} km from the studio{vehicle.isMinibus ? " · minibus" : ""}
                        {vehicle.address ? ` · ${vehicle.address}` : ""}
                      </p>
                      {suggestion && route && (
                        <p className={styles.suggestion}>
                          Suggested: Route {route.id} · {route.name} ({suggestion.visits} visits to {suggestion.place}{" "}
                          in the last {visits!.days} days)
                        </p>
                      )}
                      {!suggestion && seen && <p className={styles.help}>Recent visits: {seen}</p>}
                    </div>
                    <Link href={`/admin/vehicle?vrn=${encodeURIComponent(vehicle.vrn)}`} className={styles.primary}>
                      Add route
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
