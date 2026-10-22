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
        <Image
          src="/brand/wb-studios-leavesden-logo-white.png"
          alt="Warner Bros. Studios Leavesden"
          width={1600}
          height={382}
          className={styles.logo}
          priority
        />
        <h1 className={styles.title}>Shuttle Map</h1>
      </div>

      {/* Route key (Figma "Route filters"); picking one shows its area on the map. A route is
          filled in its colour once it has at least one minibus. */}
      <ul className={styles.routes} aria-label="Routes">
        {routes.map((route) => {
          const count = routeCounts?.get(route.id);
          return (
            <li key={route.id} className={styles.item}>
              <button
                type="button"
                className={count ? styles.route : `${styles.route} ${styles.empty}`}
                style={{ "--route": route.color } as React.CSSProperties}
                aria-label={`${route.name}. Show on map`}
                title={route.name}
                onClick={() => onSelectRoute(route.id)}
              >
                <span>{route.shortName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </header>
  );
}
