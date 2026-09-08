import type { Attribute } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";

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
export class MultiColorPathLayer extends PathLayer<MultiColorPathDatum> {
  static override layerName = "MultiColorPathLayer";

  override getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        ...shaders.inject,
        "fs:DECKGL_FILTER_COLOR": `
          // geometry.uv.x is the cross-track coordinate (-1..1). Drawing
          // the edge here keeps the outline and color on identical geometry,
          // including at zoomed-in joins and self-crossings.
          float crossPath = abs(geometry.uv.x);
          float antialiasWidth = max(fwidth(crossPath), 0.015);
          float outlineMix = smoothstep(
            0.513 - antialiasWidth,
            0.513 + antialiasWidth,
            crossPath
          );
          float outerCoverage = 1.0 - smoothstep(
            1.0 - antialiasWidth * 1.5,
            1.0,
            crossPath
          );
          color.rgb = mix(color.rgb, vec3(0.03), outlineMix);
          color.a *= mix(1.0, 0.82 * outerCoverage, outlineMix);
        `,
      },
    };
  }

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
