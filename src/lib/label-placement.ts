export interface Size {
  width: number;
  height: number;
}

/** A rectangle by its centre, in pixels relative to the vehicle being labelled. */
export interface Box extends Size {
  x: number;
  y: number;
}

/** Where to draw a label: the offset of its centre from the vehicle's position. */
export interface Placement {
  x: number;
  y: number;
}

function intersects(a: Box, b: Box, gap: number): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap
  );
}

/**
 * Positions around a marker for a label of `size`: above, below, then above/below
 * shifted to either side, then right and left. `anchor` is the marker's half-size,
 * either one number (square) or separate half-width and half-height.
 */
export function placementsAround(
  anchor: number | { halfWidth: number; halfHeight: number },
  size: Size,
  gap: number,
): Placement[] {
  const { halfWidth, halfHeight } =
    typeof anchor === "number" ? { halfWidth: anchor, halfHeight: anchor } : anchor;
  const above = -(halfHeight + gap + size.height / 2);
  const below = halfHeight + gap + size.height / 2;
  const shift = Math.max(0, size.width / 2 - halfWidth);
  const side = halfWidth + gap + size.width / 2;
  return [
    { x: 0, y: above },
    { x: 0, y: below },
    { x: shift, y: above },
    { x: -shift, y: above },
    { x: shift, y: below },
    { x: -shift, y: below },
    { x: side, y: 0 },
    { x: -side, y: 0 },
  ];
}

/** The first candidate touching none of the obstacles, or null if there is none. */
export function firstClear(
  size: Size,
  candidates: Placement[],
  obstacles: Box[],
  gap: number,
): Placement | null {
  return (
    candidates.find((candidate) =>
      obstacles.every((box) => !intersects({ ...candidate, ...size }, box, gap)),
    ) ?? null
  );
}

/**
 * Picks the first candidate where the label touches none of the obstacles or
 * soft obstacles (e.g. place-name labels). Failing that, the first one clear of
 * the obstacles alone; failing that, the first (preferred) candidate.
 */
export function placeLabel(
  size: Size,
  candidates: Placement[],
  obstacles: Box[],
  gap: number,
  softObstacles: Box[] = [],
): Placement {
  const clearOf = (candidate: Placement, boxes: Box[]) =>
    boxes.every((box) => !intersects({ ...candidate, ...size }, box, gap));
  return (
    candidates.find((candidate) => clearOf(candidate, obstacles) && clearOf(candidate, softObstacles)) ??
    candidates.find((candidate) => clearOf(candidate, obstacles)) ??
    candidates[0]
  );
}
