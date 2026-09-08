import { PathLayer } from "@deck.gl/layers";

const outlineUniforms = {
  name: "replayOutline",
  fs: `layout(std140) uniform replayOutlineUniforms { vec3 color; } replayOutline;`,
  uniformTypes: { color: "vec3<f32>" },
} as const;

/** Shade fill and border on the same depth-tested ribbon, including crossings. */
export class OutlinedPathLayer<T> extends PathLayer<T, { outlineColor?: [number, number, number] }> {
  static override layerName = "OutlinedPathLayer";
  static override defaultProps = {
    ...PathLayer.defaultProps,
    outlineColor: { type: "color" as const, value: [8, 8, 8] },
  };

  override getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [...shaders.modules, outlineUniforms],
      inject: {
        ...shaders.inject,
        "fs:DECKGL_FILTER_COLOR": `
          float crossPath = abs(geometry.uv.x);
          float antialiasWidth = max(fwidth(crossPath), 0.015);
          float outlineMix = smoothstep(
            0.513 - antialiasWidth, 0.513 + antialiasWidth, crossPath
          );
          float outerCoverage = 1.0 - smoothstep(
            1.0 - antialiasWidth * 1.5, 1.0, crossPath
          );
          color.rgb = mix(color.rgb, replayOutline.color, outlineMix);
          color.a *= mix(1.0, 0.82 * outerCoverage, outlineMix);
        `,
      },
    };
  }

  override draw(options: Parameters<PathLayer<T>["draw"]>[0]) {
    this.state.model?.shaderInputs.setProps({
      replayOutline: { color: (this.props.outlineColor ?? [8, 8, 8]).map((channel) => channel / 255) },
    });
    super.draw(options);
  }
}
