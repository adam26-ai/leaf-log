import type { Attribute } from "@deck.gl/core";
import { OutlinedPathLayer } from "./outlined-path-layer";

export type PathColor = [number, number, number] | [number, number, number, number];

export interface MultiColorPathDatum {
  path: number[][];
  colors: PathColor[];
}

function calculateColors(
  attribute: Attribute,
  {
    data,
    numInstances,
  }: { data: Iterable<MultiColorPathDatum>; numInstances: number },
) {
  // Path length changes continuously in "flight so far" mode. A fresh,
  // exactly-sized array prevents stale bytes from a previous GPU allocation
  // appearing as random colors or missing segments after the buffer grows.
  const value = new Uint8Array(numInstances * 4);
  let offset = 0;

  for (const datum of data) {
    if (datum.colors.length !== datum.path.length) {
      throw new Error("MultiColorPathLayer requires one color for every path vertex.");
    }
    for (const color of datum.colors) {
      if (offset >= value.length) break;
      value[offset++] = color[0];
      value[offset++] = color[1];
      value[offset++] = color[2];
      value[offset++] = color[3] ?? 255;
    }
  }
  attribute.value = value;
}

/**
 * One continuous PathLayer whose individual segments may have different
 * colors. This follows deck.gl's attribute-calculation extension so the
 * colored ribbon stays one path instead of becoming capped line segments.
 */
export class MultiColorPathLayer extends OutlinedPathLayer<MultiColorPathDatum> {
  static override layerName = "MultiColorPathLayer";

  override initializeState() {
    super.initializeState();
    const attributeManager = this.getAttributeManager();
    // Replace PathLayer's object-level color accessor with one color per path
    // vertex. Removing it first also releases the original GPU buffer.
    attributeManager?.remove(["instanceColors"]);
    attributeManager?.addInstanced({
      instanceColors: {
        size: 4,
        type: "unorm8",
        accessor: "getColor",
        update: calculateColors,
      },
    });
  }
}
