import { STUDIO_DESTINATION } from "./routes";
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

export function demoSnapshot(now = new Date()): FleetSnapshot {
  const fetchedAt = now.toISOString();
  return {
    mode: "demo",
    fetchedAt,
    vehicles: DEMO_VEHICLES.map((vehicle) => ({ ...vehicle, updatedAt: fetchedAt })),
  };
}
