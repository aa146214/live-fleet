import type { RouteId } from "@/lib/types";

/**
 * Optional manual overrides. Shuttles and their routes are normally detected
 * automatically from recent trips (src/lib/route-detection.ts). List a vehicle
 * here, keyed by registration (VRN, spacing and case ignored), to force its route
 * and the code shown for it, e.g. while detection hasn't seen enough loops yet.
 */
export const VEHICLE_ASSIGNMENTS: Record<string, { code: string; routeId: RouteId }> = {
  // "AB12 CDE": { code: "AB12CDE", routeId: 1 },
};

/** Until any shuttle is known, every minibus within this distance of the studio is shown. */
export const SHUTTLE_SEARCH_RADIUS_KM = 20;
