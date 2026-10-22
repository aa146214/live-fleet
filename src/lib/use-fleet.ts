"use client";

import { useEffect, useState } from "react";
import type { FleetSnapshot } from "./types";

export const POLL_INTERVAL_MS = 15_000;

/** Clock readings kept for working out this browser's clock offset. */
const CLOCK_SAMPLES = 10;

/** How long the map waits for the vehicles streamed in with the page before asking for them itself. */
const SEED_WAIT_MS = 8000;
/** Vehicles streamed in longer ago than this (an earlier visit to the page) are not used. */
const SEED_MAX_AGE_MS = 10_000;

/** The vehicles streamed in with the page (null if the server couldn't get them), and when. */
let seed: { snapshot: FleetSnapshot | null; at: number } | undefined;
const seedListeners = new Set<() => void>();

/** Called by FleetSeed when the page's vehicles arrive. */
export function seedFleet(snapshot: FleetSnapshot | null): void {
  seed = { snapshot, at: Date.now() };
  for (const listener of [...seedListeners]) listener();
}

interface FleetState {
  snapshot: FleetSnapshot | null;
  error: string | null;
  /** How far this browser's clock is ahead of FleetSmart's, in ms. */
  clockAheadMs: number;
}

/**
 * The vehicles: first those streamed in with the page, then polled from /api/vehicles
 * while the tab is visible.
 */
export function useFleet(): FleetState {
  const [state, setState] = useState<FleetState>({ snapshot: null, error: null, clockAheadMs: 0 });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Each reading also includes the response's travel time, so the smallest is the closest.
    const clockReadings: number[] = [];

    function receive(snapshot: FleetSnapshot, readClock: boolean, receivedAt = Date.now()) {
      if (readClock && snapshot.serverTime) {
        clockReadings.push(receivedAt - Date.parse(snapshot.serverTime));
        if (clockReadings.length > CLOCK_SAMPLES) clockReadings.shift();
      }
      setState({
        snapshot,
        error: snapshot.error ?? null,
        clockAheadMs: clockReadings.length ? Math.min(...clockReadings) : 0,
      });
    }

    function scheduleRefresh() {
      if (!cancelled && document.visibilityState === "visible") {
        timer = setTimeout(refresh, POLL_INTERVAL_MS);
      }
    }

    async function refresh() {
      clearTimeout(timer);
      try {
        const response = await fetch("/api/vehicles", { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        receive(body as FleetSnapshot, true);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not load vehicles";
        setState((previous) => ({ ...previous, error: message }));
      }
      scheduleRefresh();
    }

    /** Uses the page's vehicles if they have arrived; false if not (yet). */
    function takeSeed(): boolean {
      if (!seed || Date.now() - seed.at > SEED_MAX_AGE_MS) return false;
      if (seed.snapshot) {
        // A clock reading too, taken when it arrived: it may be a little high (the page's travel
        // time), but the smallest reading is the one used, so later polls only improve it. Without
        // it the first drawing would take this browser's clock to be right, and a minibus joined
        // part-way along its drive would be placed wrongly by however far the clock is out.
        receive(seed.snapshot, true, seed.at);
        scheduleRefresh();
      } else {
        refresh();
      }
      return true;
    }

    function onSeed() {
      seedListeners.delete(onSeed);
      clearTimeout(timer);
      if (!cancelled && !takeSeed()) refresh();
    }

    if (!takeSeed()) {
      seedListeners.add(onSeed);
      timer = setTimeout(() => {
        seedListeners.delete(onSeed);
        refresh();
      }, SEED_WAIT_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
      else clearTimeout(timer);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      seedListeners.delete(onSeed);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return state;
}
