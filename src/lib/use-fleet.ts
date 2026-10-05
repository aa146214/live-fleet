"use client";

import { useEffect, useState } from "react";
import type { FleetSnapshot } from "./types";

export const POLL_INTERVAL_MS = 15_000;

interface FleetState {
  snapshot: FleetSnapshot | null;
  error: string | null;
}

/** Polls /api/vehicles while the tab is visible. */
export function useFleet(): FleetState {
  const [state, setState] = useState<FleetState>({ snapshot: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      clearTimeout(timer);
      try {
        const response = await fetch("/api/vehicles", { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        setState({ snapshot: body as FleetSnapshot, error: (body as FleetSnapshot).error ?? null });
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
