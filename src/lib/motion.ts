import type { LatLng } from "./routes";
import type { VehicleStatus } from "./types";

/**
 * Makes minute-apart FleetSmart reports look like driving. When a new report
 * arrives, the marker drives from where it is drawn to the new position along the
 * road the minibus took (looked up on the server), taking as long as the minibus
 * did. So it moves continuously and stays on the road, about one report behind.
 *
 * Nothing is predicted ahead of the latest report: without knowing the route, a
 * guess would leave the road at the first bend.
 */

/** A position report as received from FleetSmart. */
export interface Fix extends LatLng {
  /** Degrees clockwise from north; null when unknown. */
  heading: number | null;
  status: VehicleStatus;
  /** The report time as FleetSmart sent it; identifies the report. */
  report: string;
  /** The report time on this browser's clock (ms since epoch). */
  at: number;
  /** The road from the previous report to this one, when it could be looked up. */
  road?: { since: string; points: LatLng[] };
}

/** Each drive takes as long as the minibus took, within these limits. */
export const MIN_DRIVE_MS = 4000;
export const MAX_DRIVE_MS = 90_000;
/** Reports further apart than this are a data gap: snap rather than drive. */
const MAX_REPORT_GAP_MS = 5 * 60_000;
/** Straight-line moves longer than this (no road known) are bad data: snap. */
const SNAP_DISTANCE_M = 1500;
/** A moving minibus that hasn't reported for this long is shown as stale. */
export const STALE_AFTER_MS = 150_000;

const METRES_PER_DEGREE = 111_320;

interface Path {
  points: LatLng[];
  /** Distance from the start to each point, in metres. */
  along: number[];
  length: number;
}

export interface Motion {
  fix: Fix;
  path: Path;
  start: number;
  duration: number;
  /** Whether the path includes the road to `fix`, not just a straight line. */
  onRoad: boolean;
}

export interface Drawn extends LatLng {
  /** The direction the marker is travelling, or the report's heading when still. */
  heading: number | null;
}

function metresBetween(a: LatLng, b: LatLng): number {
  const east = (b.lng - a.lng) * METRES_PER_DEGREE * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const north = (b.lat - a.lat) * METRES_PER_DEGREE;
  return Math.hypot(east, north);
}

function bearing(a: LatLng, b: LatLng): number {
  const east = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const north = b.lat - a.lat;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

function makePath(points: LatLng[]): Path {
  const kept: LatLng[] = [];
  for (const point of points) {
    if (kept.length === 0 || metresBetween(kept[kept.length - 1], point) > 0.5) kept.push(point);
  }
  const along = [0];
  for (let i = 1; i < kept.length; i++) along.push(along[i - 1] + metresBetween(kept[i - 1], kept[i]));
  return { points: kept, along, length: along[along.length - 1] };
}

/** The point `distance` metres along the path, and the direction of that stretch. */
function pointAlong(path: Path, distance: number): { point: LatLng; bearing: number | null } {
  const { points, along } = path;
  if (points.length < 2) return { point: points[0], bearing: null };
  let i = 1;
  while (i < points.length - 1 && along[i] < distance) i++;
  const a = points[i - 1];
  const b = points[i];
  const span = along[i] - along[i - 1];
  const t = span > 0 ? Math.min(Math.max((distance - along[i - 1]) / span, 0), 1) : 1;
  return {
    point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
    bearing: bearing(a, b),
  };
}

/** How far along the path the point closest to `p` is. */
function locate(path: Path, p: LatLng): number {
  let best = { distance: Infinity, along: 0 };
  const cos = Math.cos((p.lat * Math.PI) / 180);
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1];
    const b = path.points[i];
    const abx = (b.lng - a.lng) * cos;
    const aby = b.lat - a.lat;
    const apx = (p.lng - a.lng) * cos;
    const apy = p.lat - a.lat;
    const t = Math.min(Math.max((apx * abx + apy * aby) / (abx * abx + aby * aby || 1), 0), 1);
    const closest = { lat: a.lat + aby * t, lng: a.lng + (b.lng - a.lng) * t };
    const distance = metresBetween(p, closest);
    if (distance < best.distance) best = { distance, along: path.along[i - 1] + t * (path.along[i] - path.along[i - 1]) };
  }
  return best.along;
}

/** The path's points beyond `distance` metres along it. */
const pointsAfter = (path: Path, distance: number) => path.points.filter((_, i) => path.along[i] > distance);

const fixPoint = (fix: Fix): LatLng => ({ lat: fix.lat, lng: fix.lng });

export function startMotion(fix: Fix): Motion {
  return { fix, path: makePath([fixPoint(fix)]), start: 0, duration: 0, onRoad: false };
}

function progressAt(motion: Motion, now: number): number {
  return motion.duration > 0 ? Math.min(Math.max((now - motion.start) / motion.duration, 0), 1) : 1;
}

/** Where to draw the minibus at `now`, and which way it's pointing. */
export function drawnPosition(motion: Motion, now: number): Drawn {
  const progress = progressAt(motion, now);
  if (progress >= 1 || motion.path.length === 0) {
    return { ...fixPoint(motion.fix), heading: motion.fix.heading };
  }
  const { point, bearing } = pointAlong(motion.path, progress * motion.path.length);
  return { ...point, heading: bearing ?? motion.fix.heading };
}

/** A moving minibus whose reports have stopped arriving. */
export function isStale(fix: Fix, now: number): boolean {
  return fix.status === "moving" && now - fix.at > STALE_AFTER_MS;
}

/** Takes in the latest report, continuing from wherever the marker is drawn now. */
export function updateMotion(motion: Motion, fix: Fix, now: number): Motion {
  const drawn = drawnPosition(motion, now);
  const distanceDone = progressAt(motion, now) * motion.path.length;

  if (fix.report === motion.fix.report) {
    // The same report again. If its road has arrived since, finish the drive along it.
    const remaining = motion.start + motion.duration - now;
    if (motion.onRoad || !fix.road || remaining <= 0) return { ...motion, fix };
    const road = makePath(fix.road.points);
    const rest = pointsAfter(road, locate(road, drawn));
    return {
      fix,
      path: makePath([drawn, ...rest, fixPoint(fix)]),
      start: now,
      duration: Math.max(remaining, MIN_DRIVE_MS),
      onRoad: true,
    };
  }

  const gap = fix.at - motion.fix.at;
  if (gap <= 0 || gap > MAX_REPORT_GAP_MS) return startMotion(fix);

  // Finish the current drive, then follow the road to the new report.
  const unfinished = pointsAfter(motion.path, distanceDone);
  const onRoad = fix.road?.since === motion.fix.report;
  if (!onRoad && metresBetween(drawn, fix) > SNAP_DISTANCE_M) return startMotion(fix);
  const path = makePath([drawn, ...unfinished, ...(onRoad ? fix.road!.points : []), fixPoint(fix)]);
  if (path.length === 0) return { ...startMotion(fix) };

  return {
    fix,
    path,
    start: now,
    duration: Math.min(Math.max(gap, MIN_DRIVE_MS), MAX_DRIVE_MS),
    onRoad,
  };
}
