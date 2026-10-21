"use client";

import { useEffect } from "react";
import type { FleetSnapshot } from "@/lib/types";
import { seedFleet } from "@/lib/use-fleet";

/** Hands the vehicles streamed in with the page to the map (see useFleet). */
export function FleetSeed({ snapshot }: { snapshot: FleetSnapshot | null }) {
  useEffect(() => seedFleet(snapshot), [snapshot]);
  return null;
}
