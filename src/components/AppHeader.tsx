"use client";

import Image from "next/image";
import { ROUTES } from "@/lib/routes";
import type { RouteId } from "@/lib/types";
import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  /** Minibuses assigned to each route; null while the first data is loading. */
  routeCounts: ReadonlyMap<RouteId, number> | null;
  activeRoutes: ReadonlySet<RouteId>;
  onToggleRoute: (id: RouteId) => void;
}

export function AppHeader({ routeCounts, activeRoutes, onToggleRoute }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Image src="/brand/wb-logo.svg" alt="Warner Bros." width={46} height={47} priority />
        <h1 className={styles.title}>Leavesden Shuttle Live Map</h1>
      </div>

      <div className={styles.filters} role="group" aria-label="Show routes">
        {ROUTES.map((route) => {
          const active = activeRoutes.has(route.id);
          const count = routeCounts?.get(route.id);
          return (
            <button
              key={route.id}
              type="button"
              className={`${styles.filter} ${active ? "" : styles.filterOff}`}
              style={{ "--route": route.color } as React.CSSProperties}
              aria-pressed={active}
              aria-label={`${route.name}: ${count ?? "loading"} minibus${count === 1 ? "" : "es"}`}
              onClick={() => onToggleRoute(route.id)}
            >
              <span className={styles.filterNumber}>{count ?? "–"}</span>
              <span>{route.name}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
