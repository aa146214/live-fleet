import Image from "next/image";
import { stationPinHtml } from "@/lib/pin-art";
import { routeColor, type PinPlace } from "@/lib/routes";
import { useRoutes } from "@/lib/routes-context";
import type { RouteId } from "@/lib/types";
import { DetailsCard } from "./DetailsCard";
import styles from "./DetailsCard.module.css";

function What3Words({ address }: { address: string }) {
  return (
    <a href={`https://what3words.com/${address.replace(/^\/\/\//, "")}`} target="_blank" rel="noreferrer">
      {address}
    </a>
  );
}

const plural = (count: number) => `${count} minibus${count === 1 ? "" : "es"}`;

interface PlaceDetailsProps {
  place: PinPlace;
  routeCounts: ReadonlyMap<RouteId, number> | null;
  onClose: () => void;
}

/**
 * Details for a tapped map pin ("Tap a minibus or location for details"): where it is and the
 * routes that call there.
 */
export function PlaceDetails({ place, routeCounts, onClose }: PlaceDetailsProps) {
  const routes = useRoutes();
  const calling = routes.filter((route) => place.routeIds.includes(route.id));
  const studio = place.kind === "studio";
  const color = place.routeIds.length === 1 ? routeColor(routes, place.routeIds[0]) : "var(--color-navy)";
  const minibuses = calling.reduce((sum, route) => sum + (routeCounts?.get(route.id) ?? 0), 0);

  const rows: Array<[string, React.ReactNode]> = [];
  if (place.address) rows.push(["Address", place.address]);
  if (place.what3words) rows.push(["what3words", <What3Words key="w3w" address={place.what3words} />]);
  rows.push([calling.length === 1 ? "Route" : "Routes", calling.map((route) => route.name).join(" · ")]);
  rows.push(["Minibuses", routeCounts ? `${plural(minibuses)} on ${calling.length === 1 ? "this route" : "these routes"}` : "Loading…"]);

  return (
    <DetailsCard
      id={`place-${place.id}`}
      title={place.name}
      subtitle={studio && calling.length === routes.length ? "Served by every route" : undefined}
      color={color}
      onClose={onClose}
      closeLabel="Close location details"
      icons={
        <span className={styles.pin}>
          {studio ? (
            <Image src="/icons/pin-studio.svg" alt="" width={39} height={48} />
          ) : (
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: stationPinHtml(color) }} />
          )}
        </span>
      }
      rows={rows}
    />
  );
}
