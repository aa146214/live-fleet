import type { RouteId } from "@/lib/types";

/**
 * The Leavesden shuttles, keyed by registration (VRN) exactly as FleetSmart
 * shows it; spacing and case are ignored. Only these vehicles appear on the map, each
 * with its code and route.
 *
 * This list is only used when no database is configured (DATABASE_URL); otherwise the
 * admin at /admin manages the shuttles.
 */
export const VEHICLE_ASSIGNMENTS: Record<string, { code: string; routeId: RouteId }> = {
  // "AB12 CDE": { code: "W1", routeId: 1 },
};
