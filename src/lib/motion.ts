import type { LatLng } from "./routes";
import type { VehicleStatus } from "./types";

/**
 * Makes minute-apart FleetSmart reports look like driving. When a new report
 * arrives, the marker drives from where it is drawn to the new position along the
 * road the minibus took (looked up on the server), taking as long as the minibus
 * did. So it moves continuously and stays on the road, about one report behind.
 *
 * Where a report comes with the route road ahead of the minibus (see `Fix.ahead`) the
 * marker instead follows the minibus in near real time: it predicts the position
 * along that road from the report's speed and age, and glides onto each new report
 * rather than jumping. Without a known route nothing is predicted, because a guess
 * would leave the road at the first bend.
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
  /** The route road ahead of the minibus, starting at (or just after) the report. */
  ahead?: LatLng[];
  /** Speed in metres per second; null when unknown. */
  speed?: number | null;
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

/** Below this the minibus counts as stopped. */
const MIN_MOVING_MPS = 0.5;
/** Prediction stops this long after a report. */
const PREDICT_MAX_MS = 90_000;
/** A marker this close to the new road is on it; further and it comes from where it is drawn. */
const OFF_TRACK_M = 40;
/** A marker this far from the predicted position snaps there. */
const SNAP_FOLLOW_M = 500;
/** How fast a marker closes a gap to the predicted position. */
const GLIDE_MPS = 8;
const MAX_GLIDE_MS = 30_000;

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
  /** Set when the marker follows the minibus along `path` (road to the report, then the road ahead). */
  follow?: Follow;
}

/** How a following marker moves along its path (see `followDistance`). */
interface Follow {
  /** Where on the path the marker started, in metres. */
  from: number;
  /** When it started, and how long it takes to glide onto the predicted position. */
  start: number;
  glideMs: number;
  /** How far along the path the report is, in metres. */
  fixAlong: number;
  /** Predicted speed along the path, in metres per second (0 when stopped). */
  speed: number;
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

/** Headings look this far along the road, so a bend (or a jittery vertex) turns the marker gradually. */
const LOOKAHEAD_M = 12;
/** Closer than this, two points have no usable direction between them. */
const MIN_DIRECTION_M = 1;

/** The direction of travel at `distance`: towards the road just ahead, or from just behind at the end. */
function headingAt(path: Path, distance: number, here: LatLng): number | null {
  const ahead = pointAlong(path, Math.min(distance + LOOKAHEAD_M, path.length)).point;
  if (metresBetween(here, ahead) >= MIN_DIRECTION_M) return bearing(here, ahead);
  const behind = pointAlong(path, Math.max(distance - LOOKAHEAD_M, 0)).point;
  return metresBetween(behind, here) >= MIN_DIRECTION_M ? bearing(behind, here) : null;
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

/**
 * The first motion for a minibus. With the road from its previous report known, it
 * drives that road to the report straight away, rather than sitting still until the
 * next report arrives.
 */
export function firstMotion(fix: Fix, now: number): Motion {
  if (canFollow(fix)) return followMotion(null, fix, now);
  const road = fix.road ? makePath([...fix.road.points, fixPoint(fix)]) : null;
  if (!road || road.points.length < 2) return startMotion(fix);
  const gap = Date.parse(fix.report) - Date.parse(fix.road!.since);
  return {
    fix,
    path: road,
    start: now,
    duration: Math.min(Math.max(Number.isFinite(gap) ? gap : MIN_DRIVE_MS, MIN_DRIVE_MS), MAX_DRIVE_MS),
    onRoad: true,
  };
}

function progressAt(motion: Motion, now: number): number {
  return motion.duration > 0 ? Math.min(Math.max((now - motion.start) / motion.duration, 0), 1) : 1;
}

/** Where to draw the minibus at `now`, and which way it's pointing. */
export function drawnPosition(motion: Motion, now: number): Drawn {
  if (motion.follow) {
    const distance = followDistance(motion, now);
    const { point } = pointAlong(motion.path, distance);
    return { ...point, heading: headingAt(motion.path, distance, point) ?? motion.fix.heading };
  }
  const progress = progressAt(motion, now);
  if (progress >= 1 || motion.path.length === 0) {
    return { ...fixPoint(motion.fix), heading: motion.fix.heading };
  }
  const distance = progress * motion.path.length;
  const { point } = pointAlong(motion.path, distance);
  return {
    ...point,
    heading: headingAt(motion.path, distance, point) ?? motion.fix.heading,
  };
}

/** A moving minibus whose reports have stopped arriving. */
export function isStale(fix: Fix, now: number): boolean {
  return fix.status === "moving" && now - fix.at > STALE_AFTER_MS;
}

/** Whether a report has what following needs: a moving minibus with the road ahead. */
const canFollow = (fix: Fix) => fix.status === "moving" && (fix.ahead?.length ?? 0) >= 2;

/** Where along the path the minibus is predicted to be at `now`. */
function predictedDistance(motion: Motion, follow: Follow, now: number): number {
  const age = Math.min(Math.max(now - motion.fix.at, 0), PREDICT_MAX_MS);
  return Math.min(follow.fixAlong + (follow.speed * age) / 1000, motion.path.length);
}

/**
 * How far along the path the marker is at `now`: gliding from where it was onto the
 * predicted position, then keeping pace with it. A marker that was ahead of the
 * prediction waits for it rather than reversing.
 */
function followDistance(motion: Motion, now: number): number {
  const follow = motion.follow!;
  const predicted = predictedDistance(motion, follow, now);
  if (follow.from > predicted) return follow.from;
  const elapsed = now - follow.start;
  if (elapsed >= follow.glideMs) return predicted;
  const target = predictedDistance(motion, follow, follow.start + follow.glideMs);
  return follow.from + ((target - follow.from) * elapsed) / follow.glideMs;
}

/**
 * Starts following a report. The path is the road since the previous report, then the
 * road ahead; the marker carries on from where it is drawn now, on that path if it is
 * near it, otherwise via the road it still had to drive.
 */
function followMotion(previous: Motion | null, fix: Fix, now: number): Motion {
  const speed = fix.speed ?? 0;
  const road = fix.road && (!previous || fix.road.since === previous.fix.report) ? fix.road.points : [];
  const drawn = previous ? drawnPosition(previous, now) : null;
  const rest = [...road, fixPoint(fix)];
  const ahead = fix.ahead ?? [];

  // What the marker had still to drive of its last path, up to the previous report.
  let lead: LatLng[] = [];
  if (previous) {
    const distance = previous.follow ? followDistance(previous, now) : progressAt(previous, now) * previous.path.length;
    const until = previous.follow ? previous.follow.fixAlong : previous.path.length;
    lead = previous.path.points.filter((_, i) => previous.path.along[i] > distance && previous.path.along[i] <= until);
  }

  let path = makePath([...rest, ...ahead]);
  let fixAlong = makePath(rest).length;
  let from = 0;
  if (drawn && lead.length === 0) {
    from = locate(path, drawn);
    if (metresBetween(drawn, pointAlong(path, from).point) > OFF_TRACK_M) {
      path = makePath([drawn, ...rest, ...ahead]);
      fixAlong = makePath([drawn, ...rest]).length;
      from = 0;
    }
  } else if (drawn) {
    path = makePath([drawn, ...lead, ...rest, ...ahead]);
    fixAlong = makePath([drawn, ...lead, ...rest]).length;
  }

  const motion: Motion = {
    fix,
    path,
    start: now,
    duration: 0,
    onRoad: road.length > 0,
    follow: { from, start: now, glideMs: MIN_DRIVE_MS, fixAlong, speed: fix.status === "moving" && speed >= MIN_MOVING_MPS ? speed : 0 },
  };
  const target = predictedDistance(motion, motion.follow!, now);
  if (Math.abs(target - from) > SNAP_FOLLOW_M) motion.follow!.from = target;
  const gap = Math.max(target - motion.follow!.from, 0);
  motion.follow!.glideMs = Math.min(Math.max((gap / GLIDE_MPS) * 1000, MIN_DRIVE_MS), MAX_GLIDE_MS);
  return motion;
}

/** Takes in the latest report, continuing from wherever the marker is drawn now. */
export function updateMotion(motion: Motion, fix: Fix, now: number): Motion {
  if (canFollow(fix)) {
    if (fix.report === motion.fix.report) {
      // The same report again: only worth redoing if its road has arrived since.
      return motion.follow && (motion.onRoad || !fix.road) ? { ...motion, fix } : followMotion(motion, fix, now);
    }
    const gap = fix.at - motion.fix.at;
    return followMotion(gap <= 0 || gap > MAX_REPORT_GAP_MS ? null : motion, fix, now);
  }
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
