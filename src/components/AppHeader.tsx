"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import type { RouteId } from "@/lib/types";
import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  title: string;
  status: string;
  /** Minibuses assigned to each route; null while the first data is loading. */
  routeCounts: ReadonlyMap<RouteId, number> | null;
  activeRoutes: ReadonlySet<RouteId>;
  onToggleRoute: (id: RouteId) => void;
  page: "map" | "stops";
}

export function AppHeader({
  title,
  status,
  routeCounts,
  activeRoutes,
  onToggleRoute,
  page,
}: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.wordmark} aria-hidden="true">
          WB
        </span>
        <span className={styles.brandName}>Leavesden Shuttle</span>
      </div>

      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.status} role="status">
          {status}
        </p>
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

      {page === "map" ? (
        <Link href="/stops" className={styles.stopsLink}>
          Stops
        </Link>
      ) : (
        <span className={styles.stopsLink} aria-current="page">
          Stops
        </span>
      )}
    </header>
  );
}
