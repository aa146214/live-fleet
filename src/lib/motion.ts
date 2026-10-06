import type { LatLng } from "./routes";
import type { VehicleStatus } from "./types";

/**
 * Makes minute-apart FleetSmart positions look live: between reports each moving
 * minibus is nudged forward along its heading for a short while, and when a new
 * report arrives the marker glides onto it instead of jumping.
 *
 * Prediction is deliberately short. Without route lines it can only follow the
 * heading, so a longer guess would cut across corners and drive through buildings.
 */

/** A position report as received from FleetSmart. */
export interface Fix extends LatLng {
  /** Degrees clockwise from north; null when unknown. */
  heading: number | null;
  speedMph: number | null;
  status: VehicleStatus;
  /** When the tracker took this position (ms since epoch). */
  at: number;
}

/**
 * The predicted minibus coasts to a halt rather than stopping dead: it covers at most
 * this many seconds' worth of its reported speed (about two thirds of it in the
 * first PREDICTION_TIME_CONSTANT), however long the next report takes.
 */
export const PREDICTION_TIME_CONSTANT_MS = 15_000;
/** Below this the minibus is treated as stopped (m/s, about 1 mph). */
export const STOPPED_SPEED_MPS = 0.5;
/** A moving minibus that hasn't reported for this long is shown as stale. */
export const STALE_AFTER_MS = 150_000;
/** Gaps bigger than this are bad data or a long silence: snap rather than glide. */
export const SNAP_DISTANCE_M = 1500;
/** Glides last at least this long, longer for bigger gaps (up to the maximum). */
export const MIN_GLIDE_MS = 4000;
export const MAX_GLIDE_MS = 30_000;
const GLIDE_SPEED_MPS = 20;
/** A marker ahead of the new report waits only if it's this close to its line of travel. */
const HOLD_MAX_SIDEWAYS_M = 20;

const MPH_TO_MPS = 0.44704;
const METRES_PER_DEGREE = 111_320;

interface Vector {
  east: number;
  north: number;
}

export interface Motion {
  fix: Fix;
  /** Glide: drawn = prediction + offset, with the offset fading out over the glide. */
  offset: Vector;
  glideStart: number;
  glideMs: number;
  /** Wait: the marker overshot the new report, so it stays here until the prediction passes it. */
  hold: LatLng | null;
}

function toVector(from: LatLng, to: LatLng): Vector {
  return {
    east: (to.lng - from.lng) * METRES_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180),
    north: (to.lat - from.lat) * METRES_PER_DEGREE,
  };
}

function offsetBy(point: LatLng, { east, north }: Vector): LatLng {
  return {
    lat: point.lat + north / METRES_PER_DEGREE,
    lng: point.lng + east / (METRES_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180)),
  };
}

const length = ({ east, north }: Vector) => Math.hypot(east, north);
const dot = (a: Vector, b: Vector) => a.east * b.east + a.north * b.north;
const scaled = ({ east, north }: Vector, k: number): Vector => ({ east: east * k, north: north * k });
/** Smoothstep: starts and ends gently, so a glide blends with the movement around it. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Unit vector of travel, or null when the minibus isn't going anywhere we can predict. */
function travelDirection(fix: Fix): Vector | null {
  const speed = (fix.speedMph ?? 0) * MPH_TO_MPS;
  if (fix.status !== "moving" || fix.heading === null || speed < STOPPED_SPEED_MPS) return null;
  const radians = (fix.heading * Math.PI) / 180;
  return { east: Math.sin(radians), north: Math.cos(radians) };
}

/** Best guess of where the minibus is at `now`, judged from one report. */
export function predict(fix: Fix, now: number): LatLng {
  const direction = travelDirection(fix);
  if (!direction) return { lat: fix.lat, lng: fix.lng };
  const elapsed = Math.max(now - fix.at, 0);
  const coastSeconds = (PREDICTION_TIME_CONSTANT_MS / 1000) * (1 - Math.exp(-elapsed / PREDICTION_TIME_CONSTANT_MS));
  return offsetBy(fix, scaled(direction, (fix.speedMph ?? 0) * MPH_TO_MPS * coastSeconds));
}

/** A moving minibus whose reports have stopped arriving. */
export function isStale(fix: Fix, now: number): boolean {
  return fix.status === "moving" && now - fix.at > STALE_AFTER_MS;
}

export function startMotion(fix: Fix): Motion {
  return { fix, offset: { east: 0, north: 0 }, glideStart: 0, glideMs: 0, hold: null };
}

/** Where to draw the minibus at `now`. */
export function drawnPosition(motion: Motion, now: number): LatLng {
  const predicted = predict(motion.fix, now);

  if (motion.hold) {
    const direction = travelDirection(motion.fix);
    // Stay put until the prediction reaches the held point, then follow it.
    const behind = direction && dot(toVector(motion.hold, predicted), direction) < 0;
    return behind ? motion.hold : predicted;
  }

  const progress = motion.glideMs > 0 ? Math.min((now - motion.glideStart) / motion.glideMs, 1) : 1;
  if (progress >= 1) return predicted;
  return offsetBy(predicted, scaled(motion.offset, 1 - ease(progress)));
}

/** Takes in a new report, continuing smoothly from wherever the marker is drawn now. */
export function updateMotion(motion: Motion, fix: Fix, now: number): Motion {
  if (fix.at === motion.fix.at && fix.lat === motion.fix.lat && fix.lng === motion.fix.lng) {
    // The same report again (a poll with nothing new): keep the current glide.
    return { ...motion, fix };
  }

  const drawn = drawnPosition(motion, now);
  const target = predict(fix, now);
  const gap = toVector(target, drawn);
  const distance = length(gap);
  if (distance > SNAP_DISTANCE_M || distance < 0.5) return startMotion(fix);

  // Overshot a minibus that's still moving: wait for it rather than reversing.
  const direction = travelDirection(fix);
  if (direction) {
    const ahead = dot(gap, direction);
    const sideways = Math.abs(gap.east * direction.north - gap.north * direction.east);
    if (ahead > 0 && sideways <= HOLD_MAX_SIDEWAYS_M) {
      return { ...startMotion(fix), hold: drawn };
    }
  }

  const glideMs = Math.min(Math.max(MIN_GLIDE_MS, (distance / GLIDE_SPEED_MPS) * 1000), MAX_GLIDE_MS);
  return { fix, offset: gap, glideStart: now, glideMs, hold: null };
}
