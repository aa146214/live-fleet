"use client";

import Link from "next/link";
import { liveStatusText } from "@/lib/format";
import { countByRoute, ENTRANCES, ROUTES, routeSequence } from "@/lib/routes";
import { useFleet } from "@/lib/use-fleet";
import { useRouteFilter } from "@/lib/use-route-filter";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import styles from "./StopsScreen.module.css";

function What3Words({ address }: { address: string }) {
  return (
    <a
      className={styles.detail}
      href={`https://what3words.com/${address.replace(/^\/\/\//, "")}`}
      target="_blank"
      rel="noreferrer"
    >
      {address}
    </a>
  );
}

export function StopsScreen() {
  const { snapshot } = useFleet();
  const { activeRoutes, toggleRoute } = useRouteFilter();
  const routes = ROUTES.filter((route) => activeRoutes.has(route.id));

  return (
    <div className={styles.screen}>
      <AppHeader
        title="Stops"
        status={liveStatusText(snapshot)}
        routeCounts={snapshot ? countByRoute(snapshot.vehicles) : null}
        activeRoutes={activeRoutes}
        onToggleRoute={toggleRoute}
        page="stops"
      />

      <main className={styles.content}>
        <h2 className={styles.heading}>Your shuttle stops</h2>
        <p className={styles.intro}>Every route calls at Gate B, then Gate A, before returning to its station.</p>

        <ul className={styles.stops}>
          {routes.map((route) => (
            <li key={route.id} className={styles.stop}>
              <h3 className={styles.name}>
                {route.id} · {route.station}
              </h3>
              <What3Words address={route.what3words} />
              <p className={styles.sequence}>{routeSequence(route)}</p>
            </li>
          ))}
          {ENTRANCES.map((entrance) => (
            <li key={entrance.name} className={styles.stop}>
              <h3 className={styles.name}>{entrance.name}</h3>
              {entrance.detail.startsWith("///") ? (
                <What3Words address={entrance.detail} />
              ) : (
                <p className={styles.detail}>{entrance.detail}</p>
              )}
            </li>
          ))}
        </ul>

        <p className={styles.note}>Gate A/B and entrance locations need confirmation before live implementation.</p>

        <Link href="/" className={styles.back}>
          ← Back to live map
        </Link>
      </main>

      <BottomNav page="stops" />
    </div>
  );
}
