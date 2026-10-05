import Image from "next/image";
import { formatUpdated } from "@/lib/format";
import { getRoute, routeColor, routeSequence, routeSubtitle, shortDestination } from "@/lib/routes";
import type { Vehicle } from "@/lib/types";
import { DetailsCard } from "./DetailsCard";
import styles from "./DetailsCard.module.css";

interface VehicleDetailsProps {
  vehicle: Vehicle;
  onClose: () => void;
}

/** Figma "Vehicle details / W1" (updated design): operator logo, then the vehicle's facts. */
export function VehicleDetails({ vehicle, onClose }: VehicleDetailsProps) {
  const route = getRoute(vehicle.routeId);
  const color = routeColor(vehicle.routeId);

  return (
    <DetailsCard
      id={`vehicle-${vehicle.code}`}
      title={`Minibus ${vehicle.code}`}
      subtitle={route ? routeSubtitle(route) : "No route"}
      color={color}
      onClose={onClose}
      closeLabel="Close vehicle details"
      icons={
        <>
          <span className={styles.icon} style={{ background: color }}>
            <Image src="/icons/bus-card.svg" alt="" width={24} height={24} />
          </span>
          <span className={styles.operator}>
            <Image src="/brand/hr-transport.png" alt="HR Transport" width={84} height={47} />
          </span>
        </>
      }
      rows={[
        ["Vehicle registration", vehicle.registration],
        ["Next destination", shortDestination(vehicle.nextDestination)],
        ["Vehicle location", vehicle.address],
        ["Route information", route ? routeSequence(route) : "Not assigned to a shuttle route"],
        ["Last updated", formatUpdated(vehicle.updatedAt)],
      ]}
    />
  );
}
