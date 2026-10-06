"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countByRoute, getPlace, type PlaceId } from "@/lib/routes";
import { useFleet } from "@/lib/use-fleet";
import { AppHeader } from "./AppHeader";
import { FadeThrough } from "./FadeThrough";
import { PlaceDetails } from "./PlaceDetails";
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
  const { snapshot, error, clockAheadMs } = useFleet();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get("vehicle");
  const selectedPlace = getPlace(searchParams.get("place")) ?? null;

  const visibleVehicles = useMemo(() => snapshot?.vehicles ?? [], [snapshot]);
  const selected = visibleVehicles.find((vehicle) => vehicle.code === selectedParam) ?? null;
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
    if (!selected && !selectedPlace) return;
    const timer = setTimeout(
      () => detailsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      120,
    );
    return () => clearTimeout(timer);
  }, [selected?.code, selectedPlace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Selects a minibus or a map pin (one at a time), or clears the selection; kept in the URL. */
  const setSelection = useCallback(
    (selection: { vehicle?: string; place?: PlaceId } | null) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("vehicle");
      params.delete("place");
      if (selection?.vehicle) params.set("vehicle", selection.vehicle);
      if (selection?.place) params.set("place", selection.place);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const select = useCallback((code: string | null) => setSelection(code ? { vehicle: code } : null), [setSelection]);
  const selectPlace = useCallback((id: PlaceId) => setSelection({ place: id }), [setSelection]);
  const clearSelection = useCallback(() => setSelection(null), [setSelection]);

  const hasDetails = Boolean(selected || selectedPlace);
  useEffect(() => {
    if (!hasDetails) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasDetails, clearSelection]);

  const mode = snapshot?.mode ?? null;

  return (
    <div className={`${styles.screen} ${hasDetails ? styles.hasSelection : ""}`}>
      <AppHeader routeCounts={routeCounts} />

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
            selectedPlaceId={selectedPlace?.id ?? null}
            onSelectPlace={selectPlace}
            mode={mode}
            clockAheadMs={clockAheadMs}
          />
        </div>

        <aside className={styles.panel} aria-label="Vehicles">
          <div className={`${styles.listSection} ${hasDetails ? styles.withDetails : ""}`}>
            <h2 className={styles.panelTitle}>All vehicles</h2>
            <p className={styles.panelHint}>Select a minibus to see its details.</p>
            {!snapshot ? (
              <p className={styles.empty}>{error ? "Could not load vehicles." : "Loading vehicles…"}</p>
            ) : visibleVehicles.length === 0 ? (
              <p className={styles.empty}>No minibuses are reporting a position right now.</p>
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
            <FadeThrough contentKey={selected ? `vehicle:${selected.code}` : selectedPlace ? `place:${selectedPlace.id}` : ""}>
              {selected ? (
                <VehicleDetails vehicle={selected} onClose={clearSelection} />
              ) : selectedPlace ? (
                <PlaceDetails place={selectedPlace} routeCounts={routeCounts} onClose={clearSelection} />
              ) : (
                <div className={styles.guidance}>
                  <p className={styles.guidanceTitle}>Tap a minibus or location for details</p>
                  <p className={styles.guidanceText}>Arrows show the direction of travel</p>
                </div>
              )}
            </FadeThrough>
          </div>
        </aside>
      </main>
    </div>
  );
}
