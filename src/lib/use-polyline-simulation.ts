"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRoutePolyline, getPositionAlongPolyline, type PolylinePosition } from "./polyline-simulation";
import type { LatLng } from "./routes";

export interface PolylineSimulation extends PolylinePosition {
  /** The road geometry being driven; empty until it has loaded. */
  polyline: LatLng[];
  /** "loading" while the route is fetched, then "running" until the end, then "finished". */
  status: "loading" | "running" | "finished";
}

const IDLE: PolylineSimulation = {
  polyline: [],
  position: { lat: 0, lng: 0 },
  heading: 0,
  isFinished: false,
  status: "loading",
};

/**
 * Fetches the road through `stops`, then drives a vehicle along it at `speedKmH`,
 * updating every animation frame. Changing the stops (by value) or speed restarts
 * the drive from the first stop.
 */
export function usePolylineSimulation(stops: LatLng[], speedKmH: number): PolylineSimulation {
  // Callers usually pass a fresh array each render, so key the effect on its contents.
  const stopsKey = JSON.stringify(stops);
  const stable = useMemo<LatLng[]>(() => JSON.parse(stopsKey), [stopsKey]);
  const [state, setState] = useState<{ key: string; sim: PolylineSimulation }>({ key: "", sim: IDLE });
  const key = `${stopsKey}|${speedKmH}`;

  useEffect(() => {
    const controller = new AbortController();
    let frame = 0;

    function run(polyline: LatLng[]) {
      const startedAt = performance.now();
      const tick = (now: number) => {
        const result = getPositionAlongPolyline(polyline, speedKmH, (now - startedAt) / 1000);
        setState({
          key,
          sim: { ...result, polyline, status: result.isFinished ? "finished" : "running" },
        });
        if (!result.isFinished) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    fetchRoutePolyline(stable, controller.signal).then(run, () => {});

    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
    };
  }, [stable, speedKmH, key]);

  // Until this drive's first frame, don't show the previous drive's position.
  return state.key === key ? state.sim : IDLE;
}
