import Image from "next/image";
import { formatUpdated } from "@/lib/format";
import { getRoute, routeColor, routeSequence } from "@/lib/routes";
import type { FleetSnapshot, Vehicle } from "@/lib/types";
import styles from "./VehicleDetails.module.css";

interface VehicleDetailsProps {
  vehicle: Vehicle;
  mode: FleetSnapshot["mode"];
  onClose: () => void;
}

export function VehicleDetails({ vehicle, mode, onClose }: VehicleDetailsProps) {
  const route = getRoute(vehicle.routeId);
  const color = routeColor(vehicle.routeId);
  const headingId = `vehicle-${vehicle.code}-title`;

  const rows: Array<[string, string]> = [
    ["Vehicle location", vehicle.address],
    ["Route information", route ? routeSequence(route) : "Not assigned to a shuttle route"],
    ["Next destination", vehicle.nextDestination],
    ["Vehicle registration", vehicle.registration],
    ["Last updated", formatUpdated(vehicle.updatedAt)],
  ];

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.heading}>
        <span className={styles.icon} style={{ background: color }}>
          <Image src="/icons/bus-card.svg" alt="" width={24} height={28} />
        </span>
        <div className={styles.name}>
          <h2 id={headingId} className={styles.title}>
            Minibus {vehicle.code}
          </h2>
          <p className={styles.routeName} style={{ color }}>
            {route ? `Route ${route.id} · ${route.name}` : "No route"}
          </p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close vehicle details">
          ×
        </button>
      </div>

      <dl className={styles.rows}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt className={styles.label}>{label}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.note}>
        {mode === "demo"
          ? "Illustrative vehicle data"
          : "Live FleetSmart data · next destination is estimated from direction of travel"}
      </p>
    </section>
  );
}
