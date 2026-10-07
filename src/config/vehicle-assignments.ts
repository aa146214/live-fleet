import type { RouteId } from "@/lib/types";

/**
 * The Leavesden shuttles, keyed by registration (VRN) exactly as FleetSmart
 * shows it; spacing and case are ignored. These get a code and a route; every other
 * minibus within SHUTTLE_SEARCH_RADIUS_KM of the studio is shown too, labelled by
 * registration and without a route, so you can spot which ones to add here.
 *
 * This list is only used when no database is configured (DATABASE_URL); otherwise the
 * admin at /admin manages the shuttles.
 */
export const VEHICLE_ASSIGNMENTS: Record<string, { code: string; routeId: RouteId }> = {
  // "AB12 CDE": { code: "W1", routeId: 1 },
};

export const SHUTTLE_SEARCH_RADIUS_KM = 20;
