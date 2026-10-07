import Image from "next/image";
import { ENTRANCES, getRoute, routeColor, routeSequence, routeSubtitle, type Place } from "@/lib/routes";
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
  place: Place;
  routeCounts: ReadonlyMap<RouteId, number> | null;
  onClose: () => void;
}

/**
 * Details for a tapped map pin ("Tap a minibus or location for details"):
 * a station's route and what3words address, or the studio's entrances.
 */
export function PlaceDetails({ place, routeCounts, onClose }: PlaceDetailsProps) {
  const routes = useRoutes();
  const route = getRoute(routes, place.routeId);
  const common = { id: `place-${place.id}`, title: place.name, onClose, closeLabel: "Close location details" };

  if (route) {
    return (
      <DetailsCard
        {...common}
        subtitle={routeSubtitle(route)}
        color={routeColor(route.id)}
        icons={
          <span className={styles.pin}>
            <Image src={`/icons/pin-route${route.id}.svg`} alt="" width={43} height={43} />
          </span>
        }
        rows={[
          ["what3words", <What3Words key="w3w" address={route.what3words} />],
          ["Route information", routeSequence(route)],
          ["Minibuses", routeCounts ? `${plural(routeCounts.get(route.id) ?? 0)} on this route` : "Loading…"],
        ]}
      />
    );
  }

  return (
    <DetailsCard
      {...common}
      subtitle="Served by every route"
      color="var(--color-navy)"
      icons={
        <span className={styles.pin}>
          <Image src="/icons/pin-studio.svg" alt="" width={39} height={48} />
        </span>
      }
      rows={[
        ...ENTRANCES.filter(({ name }) => name === place.entrance).map(({ name, detail }): [string, React.ReactNode] => [
          name,
          detail.startsWith("///") ? <What3Words key={name} address={detail} /> : detail,
        ]),
        ["Routes", routes.map((r) => `${r.id} ${r.name}`).join(" · ")],
      ]}
    />
  );
}
