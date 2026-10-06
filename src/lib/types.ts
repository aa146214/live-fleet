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
  updatedAt: string | null;
  nextDestination: string;
}

export interface FleetSnapshot {
  mode: "live" | "demo";
  vehicles: Vehicle[];
  fetchedAt: string;
  /** Set when the latest refresh failed and older data is being served. */
  error?: string;
}
