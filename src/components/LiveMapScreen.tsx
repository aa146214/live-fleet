"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveStatusText } from "@/lib/format";
import { countByRoute } from "@/lib/routes";
import { useFleet } from "@/lib/use-fleet";
import { useRouteFilter } from "@/lib/use-route-filter";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { DemoNotice } from "./DemoNotice";
import { FadeThrough } from "./FadeThrough";
import { VehicleDetails } from "./VehicleDetails";
import { VehicleRow } from "./VehicleRow";
import styles from "./LiveMapScreen.module.css";

// Leaflet needs `window`, so the map only renders in the browser.
const FleetMap = dynamic(() => import("./FleetMap"), {
  ssr: false,
  loading: () => <div className={styles.mapPlaceholder} />,
});

/** Rows shown before "Show more", matching the six rows in the Figma sidebar. */
const LIST_LIMIT = 6;

export function LiveMapScreen() {
  const { snapshot, error } = useFleet();
  const { activeRoutes, toggleRoute } = useRouteFilter();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get("vehicle");

  const visibleVehicles = useMemo(
    () =>
      (snapshot?.vehicles ?? []).filter(
        (vehicle) => vehicle.routeId === null || activeRoutes.has(vehicle.routeId),
      ),
    [snapshot, activeRoutes],
  );
  const selected = visibleVehicles.find((vehicle) => vehicle.code === selectedParam) ?? null;
  // Counted over all vehicles, so turning a route filter off doesn't change its number.
  const routeCounts = useMemo(() => (snapshot ? countByRoute(snapshot.vehicles) : null), [snapshot]);

  const [expanded, setExpanded] = useState(false);
  const firstVehicles = visibleVehicles.slice(0, LIST_LIMIT);
  const moreVehicles = visibleVehicles.slice(LIST_LIMIT);
  // A collapsed list still shows the selected minibus, so a pick on the map always appears here.
  const pinnedSelection =
    !expanded && selected && moreVehicles.some((vehicle) => vehicle.code === selected.code)
      ? selected
      : null;
  const hiddenCount = expanded ? 0 : moreVehicles.length - (pinnedSelection ? 1 : 0);

  const renderRow = (vehicle: (typeof visibleVehicles)[number]) => (
    <li key={vehicle.id}>
      <VehicleRow vehicle={vehicle} selected={vehicle.code === selected?.code} onSelect={select} />
    </li>
  );

  // The details card sits below the list, so bring it into view when the selection changes,
  // once the fade-through has swapped in the new card (and its final height).
  const detailsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(
      () => detailsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      120,
    );
    return () => clearTimeout(timer);
  }, [selected?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(
    (code: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (code) params.set("vehicle", code);
      else params.delete("vehicle");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, select]);

  const mode = snapshot?.mode ?? null;

  return (
    <div className={`${styles.screen} ${selected ? styles.hasSelection : ""}`}>
      <AppHeader
        title="Live map"
        status={liveStatusText(snapshot)}
        routeCounts={routeCounts}
        activeRoutes={activeRoutes}
        onToggleRoute={toggleRoute}
        page="map"
      />

      {snapshot?.notice && !error && <p className={styles.notice}>{snapshot.notice}</p>}

      {error && (
        <p className={styles.error} role="alert">
          Live data unavailable ({error}).{" "}
          {snapshot ? "Showing the last known positions." : "Retrying shortly."}
        </p>
      )}

      <main className={styles.main}>
        <div className={styles.mapArea}>
          <FleetMap
            vehicles={visibleVehicles}
            selectedCode={selected?.code ?? null}
            onSelect={select}
            mode={mode}
          />
        </div>

        <aside className={styles.panel} aria-label="Vehicles">
          <div className={styles.listSection}>
            <h2 className={styles.panelTitle}>All vehicles</h2>
            <p className={styles.panelHint}>Select a minibus to see its details.</p>
            {!snapshot ? (
              <p className={styles.empty}>{error ? "Could not load vehicles." : "Loading vehicles…"}</p>
            ) : visibleVehicles.length === 0 ? (
              <p className={styles.empty}>
                {snapshot.vehicles.length === 0
                  ? "No minibuses are reporting a position right now."
                  : "No minibuses on the selected routes."}
              </p>
            ) : (
              <>
                <div id="vehicle-list" className={styles.list}>
                  <ul className={styles.rows}>{firstVehicles.map(renderRow)}</ul>
                  {pinnedSelection && (
                    <ul className={`${styles.rows} ${styles.pinned}`} key={pinnedSelection.id}>
                      {renderRow(pinnedSelection)}
                    </ul>
                  )}
                  {moreVehicles.length > 0 && (
                    // Animates open and closed; `inert` keeps hidden rows out of the tab order.
                    <div className={`${styles.more} ${expanded ? styles.moreOpen : ""}`} inert={!expanded}>
                      <ul className={styles.rows}>{moreVehicles.map(renderRow)}</ul>
                    </div>
                  )}
                </div>
                {visibleVehicles.length > LIST_LIMIT && (
                  <button
                    type="button"
                    className={styles.showMore}
                    aria-expanded={expanded}
                    aria-controls="vehicle-list"
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? "Show fewer" : `Show ${hiddenCount} more`}
                  </button>
                )}
              </>
            )}
          </div>

          <div ref={detailsRef}>
            <FadeThrough contentKey={selected && mode ? selected.code : ""}>
              {selected && mode ? (
                <VehicleDetails vehicle={selected} mode={mode} onClose={() => select(null)} />
              ) : (
                <>
                  <p className={styles.chooseHint}>
                    Choose a minibus on the map or in this list. Arrows show direction of travel;
                    dots are stopped.
                  </p>
                  <div className={styles.guidance}>
                    <p className={styles.guidanceTitle}>Tap a minibus for details</p>
                    <p className={styles.guidanceText}>
                      Arrows show direction of travel · dots are stopped
                    </p>
                  </div>
                </>
              )}
            </FadeThrough>
          </div>
        </aside>
      </main>

      <BottomNav page="map" />
      <DemoNotice mode={mode} />
    </div>
  );
}
