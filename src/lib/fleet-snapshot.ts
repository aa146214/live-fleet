import { demoSnapshot } from "./demo-fleet";
import { fleetSmartNow, getLiveSnapshot, hasFleetSmartCredentials } from "./fleetsmart";
import type { FleetSnapshot } from "./types";

/**
 * What the map shows: the shuttles live from FleetSmart, or the demo buses (with
 * FLEET_DEMO=1 or no API key). Used by the page, which streams the first one in, and by
 * /api/vehicles, which the map polls. Server only.
 */
export async function currentSnapshot(): Promise<FleetSnapshot> {
  // FLEET_DEMO=1 forces the design's illustrative vehicles (e.g. for design reviews).
  if (process.env.FLEET_DEMO === "1" || !hasFleetSmartCredentials()) return demoSnapshot();
  return { ...(await getLiveSnapshot()), serverTime: fleetSmartNow() };
}
