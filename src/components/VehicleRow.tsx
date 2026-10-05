import { getRoute, routeColor } from "@/lib/routes";
import type { Vehicle } from "@/lib/types";
import styles from "./VehicleRow.module.css";

interface VehicleRowProps {
  vehicle: Vehicle;
  selected: boolean;
  onSelect: (code: string) => void;
}

export function VehicleRow({ vehicle, selected, onSelect }: VehicleRowProps) {
  const route = getRoute(vehicle.routeId);
  return (
    <button
      type="button"
      className={`${styles.row} ${selected ? styles.selected : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(vehicle.code)}
    >
      <span className={styles.badge} style={{ background: routeColor(vehicle.routeId) }}>
        {vehicle.code}
      </span>
      <span className={styles.text}>
        <span className={styles.route}>
          {route ? `${route.name} · Route ${route.id}` : "Unassigned minibus"}
        </span>
        <span className={styles.next}>
          {route ? `Next: ${vehicle.nextDestination}` : vehicle.address}
        </span>
      </span>
    </button>
  );
}
