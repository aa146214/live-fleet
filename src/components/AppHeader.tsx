import Image from "next/image";
import { useRoutes } from "@/lib/routes-context";
import type { RouteId } from "@/lib/types";
import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  /** Minibuses assigned to each route; null while the first data is loading. */
  routeCounts: ReadonlyMap<RouteId, number> | null;
  /** Called when a route is picked, to show that route's area on the map. */
  onSelectRoute: (id: RouteId) => void;
}

export function AppHeader({ routeCounts, onSelectRoute }: AppHeaderProps) {
  const routes = useRoutes();
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Image src="/brand/wb-logo.svg" alt="Warner Bros." width={46} height={47} priority />
        <h1 className={styles.title}>Warner Bros. Studios Leavesden Shuttle Live Map</h1>
      </div>

      {/* Route key with live minibus counts (Figma "Route filters"); picking one shows its area
          on the map. A route is filled in its colour once it has at least one minibus. */}
      <ul className={styles.routes} aria-label="Minibuses per route">
        {routes.map((route) => {
          const count = routeCounts?.get(route.id);
          return (
            <li key={route.id} className={styles.item}>
              <button
                type="button"
                className={count ? styles.route : `${styles.route} ${styles.empty}`}
                style={{ "--route": route.color } as React.CSSProperties}
                aria-label={`${route.name}: ${count ?? "loading"} minibus${count === 1 ? "" : "es"}. Show on map`}
                onClick={() => onSelectRoute(route.id)}
              >
                <span className={styles.routeCount}>{count ?? "–"}</span>
                <span>{route.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </header>
  );
}
