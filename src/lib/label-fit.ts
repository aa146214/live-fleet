export interface LabelBox {
  /** Label centre in screen pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clear space this label needs around it (e.g. room for a direction arrow). */
  margin: number;
}

/** True when every label can be drawn without touching or crowding another. */
export function labelsFit(boxes: LabelBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const spacing = a.margin + b.margin;
      if (
        Math.abs(a.x - b.x) < (a.width + b.width) / 2 + spacing &&
        Math.abs(a.y - b.y) < (a.height + b.height) / 2 + spacing
      ) {
        return false;
      }
    }
  }
  return true;
}
