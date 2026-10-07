import Link from "next/link";
import { adminListAssignments, adminListRoutes, normaliseVrn } from "@/lib/config-store";
import { hasFleetSmartCredentials, listFleetVehicles } from "@/lib/fleetsmart";
import { MAX_STOPS } from "@/lib/admin-validation";
import { placesFor } from "@/lib/routes";
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

  const places = placesFor(routes);
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
          places={places.map(({ id, name }) => ({ id, name }))}
          routes={routeOptions}
          initialRouteId={existing?.routeId ?? null}
          maxStops={MAX_STOPS}
        />
      </section>
    </>
  );
}
