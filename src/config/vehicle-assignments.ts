import type { RouteId } from "@/lib/types";

/**
 * The Leavesden shuttles, keyed by registration (VRN) exactly as FleetSmart
 * shows it; spacing and case are ignored. Only these vehicles appear on the map.
 *
 * While this list is empty the app shows every minibus within
 * SHUTTLE_SEARCH_RADIUS_KM of the studio instead, labelled by registration,
 * so you can spot which ones to add here.
 */
export const VEHICLE_ASSIGNMENTS: Record<string, { code: string; routeId: RouteId }> = {
  // "AB12 CDE": { code: "W1", routeId: 1 },
};

export const SHUTTLE_SEARCH_RADIUS_KM = 20;
