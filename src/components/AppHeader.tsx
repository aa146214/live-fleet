import Image from "next/image";
import { ROUTES } from "@/lib/routes";
import type { RouteId } from "@/lib/types";
import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  /** Minibuses assigned to each route; null while the first data is loading. */
  routeCounts: ReadonlyMap<RouteId, number> | null;
}

export function AppHeader({ routeCounts }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Image src="/brand/wb-logo.svg" alt="Warner Bros." width={46} height={47} priority />
        <h1 className={styles.title}>Leavesden Shuttle Live Map</h1>
      </div>

      {/* Route key with live minibus counts (Figma "Route filters"); not interactive.
          A route is filled in its colour once it has at least one minibus. */}
      <ul className={styles.routes} aria-label="Minibuses per route">
        {ROUTES.map((route) => {
          const count = routeCounts?.get(route.id);
          return (
            <li
              key={route.id}
              className={count ? styles.route : `${styles.route} ${styles.empty}`}
              style={{ "--route": route.color } as React.CSSProperties}
              aria-label={`${route.name}: ${count ?? "loading"} minibus${count === 1 ? "" : "es"}`}
            >
              <span className={styles.routeCount}>{count ?? "–"}</span>
              <span>{route.name}</span>
            </li>
          );
        })}
      </ul>
    </header>
  );
}
