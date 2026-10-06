"use client";

import { useEffect, useState } from "react";
import type { FleetSnapshot } from "./types";

export const POLL_INTERVAL_MS = 15_000;

/** Clock readings kept for working out this browser's clock offset. */
const CLOCK_SAMPLES = 10;

interface FleetState {
  snapshot: FleetSnapshot | null;
  error: string | null;
  /** How far this browser's clock is ahead of FleetSmart's, in ms. */
  clockAheadMs: number;
}

/** Polls /api/vehicles while the tab is visible. */
export function useFleet(): FleetState {
  const [state, setState] = useState<FleetState>({ snapshot: null, error: null, clockAheadMs: 0 });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Each reading also includes the response's travel time, so the smallest is the closest.
    const clockReadings: number[] = [];

    async function refresh() {
      clearTimeout(timer);
      try {
        const response = await fetch("/api/vehicles", { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        const snapshot = body as FleetSnapshot;
        if (snapshot.serverTime) {
          clockReadings.push(Date.now() - Date.parse(snapshot.serverTime));
          if (clockReadings.length > CLOCK_SAMPLES) clockReadings.shift();
        }
        setState({
          snapshot,
          error: snapshot.error ?? null,
          clockAheadMs: clockReadings.length ? Math.min(...clockReadings) : 0,
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not load vehicles";
        setState((previous) => ({ ...previous, error: message }));
      }
      if (!cancelled && document.visibilityState === "visible") {
        timer = setTimeout(refresh, POLL_INTERVAL_MS);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
      else clearTimeout(timer);
    }

    refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return state;
}
