import { slicePolyline, positionAtDistance, streetAt } from "./polyline-simulation";
import { loopStopsFor, loopWithin, nextStop, roadAhead } from "./route-loops";
import { getRoutes } from "./config-store";
import { defaultStops, getRoute, placesFor, STUDIO_DESTINATION } from "./routes";
import type { FleetSnapshot, Vehicle } from "./types";

// Illustrative vehicles from the Figma design, used when no FleetSmart credentials are set.
const DEMO_VEHICLES: Omit<Vehicle, "updatedAt">[] = [
  {
    id: "demo-w1",
    code: "W1",
    routeId: 1,
    registration: "LK24 WBS",
    lat: 51.6575,
    lng: -0.4005,
    heading: 45,
    speedMph: 18,
    status: "moving",
    address: "Clarendon Road, Watford",
    nextDestination: STUDIO_DESTINATION,
  },
  {
    id: "demo-w2",
    code: "W2",
    routeId: 1,
    registration: "LK24 WBT",
    lat: 51.6795,
    lng: -0.3985,
    heading: 180,
    speedMph: 22,
    status: "moving",
    address: "North Western Avenue, Watford",
    nextDestination: "Watford Junction station",
  },
  {
    id: "demo-s1",
    code: "S1",
    routeId: 2,
    registration: "LK24 WBU",
    lat: 51.7405,
    lng: -0.3395,
    heading: 220,
    speedMph: 25,
    status: "moving",
    address: "Watford Road, St Albans",
    nextDestination: STUDIO_DESTINATION,
  },
  {
    id: "demo-s2",
    code: "S2",
    routeId: 2,
    registration: "LK24 WBV",
    lat: 51.7105,
    lng: -0.3645,
    heading: 20,
    speedMph: 31,
    status: "moving",
    address: "High Road, Leavesden",
    nextDestination: "St Albans station",
  },
  {
    id: "demo-r1",
    code: "R1",
    routeId: 3,
    registration: "LK24 WBW",
    lat: 51.6505,
    lng: -0.4435,
    heading: 30,
    speedMph: 20,
    status: "moving",
    address: "Rickmansworth Road",
    nextDestination: STUDIO_DESTINATION,
  },
  {
    id: "demo-r2",
    code: "R2",
    routeId: 3,
    registration: "LK24 WBX",
    lat: 51.6815,
    lng: -0.4475,
    heading: 220,
    speedMph: 24,
    status: "moving",
    address: "Hempstead Road, Watford",
    nextDestination: "Rickmansworth station",
  },
];

/** The demo minibuses "report" this often, on the clock, so every poll sees a new report. */
const REPORT_INTERVAL_MS = 15_000;
const MPH_TO_MPS = 0.44704;
/** The router answers one request a second, so the first snapshot waits this long, then goes without. */
const LOOP_WAIT_MS = 4000;
/**
 * Illustrative vehicles that keep driving: each shuttles along the road between its
 * route's station and the studio, reporting every REPORT_INTERVAL_MS like a tracker,
 * with the road driven since the last report attached. Positions come from the clock
 * alone, so the answer needs no state and every browser sees the same minibuses.
 */
export async function demoSnapshot(now = new Date()): Promise<FleetSnapshot> {
  const reportAt = Math.floor(now.getTime() / REPORT_INTERVAL_MS) * REPORT_INTERVAL_MS;
  const updatedAt = new Date(reportAt).toISOString();
  const previousAt = new Date(reportAt - REPORT_INTERVAL_MS).toISOString();

  const routes = await getRoutes();
  const places = placesFor(routes);
  const vehicles = await Promise.all(
    DEMO_VEHICLES.map(async (vehicle): Promise<Vehicle> => {
      const route = getRoute(routes, vehicle.routeId);
      if (!route) return { ...vehicle, updatedAt };
      const stopIds = defaultStops(route);
      const stops = loopStopsFor(stopIds, places, routes);
      if (!stops) return { ...vehicle, updatedAt };
      const loop = await loopWithin(stops, LOOP_WAIT_MS);
      const { points, cycle, streets } = loop;
      if (cycle === 0) return { ...vehicle, updatedAt };

      const speed = (vehicle.speedMph ?? 20) * MPH_TO_MPS;
      // Minibuses on the same route start at different points along it.
      const peers = DEMO_VEHICLES.filter((v) => v.routeId === vehicle.routeId);
      const offset = (0.2 + (0.5 * peers.indexOf(vehicle)) / peers.length) * (cycle / 2);
      const at = (ms: number) => ((((speed * ms) / 1000 + offset) % cycle) + cycle) % cycle;

      const to = at(reportAt);
      const from = at(reportAt - REPORT_INTERVAL_MS);
      // The drive since the last report, in two parts if it passed the start of the loop.
      const road =
        from <= to
          ? slicePolyline(points, from, to)
          : [...slicePolyline(points, from, cycle), ...slicePolyline(points, 0, to)];
      const { position, heading } = positionAtDistance(points, to);

      return {
        ...vehicle,
        lat: position.lat,
        lng: position.lng,
        heading: Math.round(heading),
        address: streetAt(streets, to) ?? vehicle.address,
        nextDestination: nextStop(loop, to),
        stops: stopIds,
        updatedAt,
        road: { since: previousAt, points: road },
        ahead: roadAhead(loop, to, speed),
      };
    }),
  );

  return {
    mode: "demo",
    fetchedAt: now.toISOString(),
    serverTime: now.toISOString(),
    routes,
    vehicles,
  };
}
