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
 * Positions around a marker of radius `anchorHalf` for a label of `size`:
 * above, below, then above/below shifted to either side, then right and left.
 */
export function placementsAround(anchorHalf: number, size: Size, gap: number): Placement[] {
  const above = -(anchorHalf + gap + size.height / 2);
  const below = anchorHalf + gap + size.height / 2;
  const shift = Math.max(0, size.width / 2 - anchorHalf);
  const side = anchorHalf + gap + size.width / 2;
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
