export type RouteId = 1 | 2 | 3;

export type VehicleStatus = "moving" | "idling" | "stopped" | "unknown";

export interface Vehicle {
  id: string;
  /** Short shuttle code shown on markers, e.g. "W1". */
  code: string;
  routeId: RouteId | null;
  registration: string;
  lat: number;
  lng: number;
  /** Bearing in degrees clockwise from north, or null when unknown. */
  heading: number | null;
  speedMph: number | null;
  status: VehicleStatus;
  address: string;
  /** When the tracker took this position. */
  updatedAt: string | null;
  nextDestination: string;
  /** The road driven since the previous report (ending here), when it could be looked up. */
  road?: {
    /** The previous report's time. */
    since: string;
    points: { lat: number; lng: number }[];
  };
}

export interface FleetSnapshot {
  mode: "live" | "demo";
  vehicles: Vehicle[];
  fetchedAt: string;
  /** The time by FleetSmart's clock when this response was sent (see fleetSmartNow). */
  serverTime?: string;
  /** Set when the latest refresh failed and older data is being served. */
  error?: string;
}
