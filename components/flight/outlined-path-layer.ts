import { PathLayer } from "@deck.gl/layers";

const outlineUniforms = {
  name: "replayOutline",
  fs: `layout(std140) uniform replayOutlineUniforms {
    vec3 color;
    vec2 alpha;
  } replayOutline;`,
  uniformTypes: { color: "vec3<f32>", alpha: "vec2<f32>" },
} as const;

/** Shade fill and border on the same depth-tested ribbon, including crossings. */
export class OutlinedPathLayer<T> extends PathLayer<T, { outlineColor?: [number, number, number]; fillAlpha?: number; outlineAlpha?: number }> {
  static override layerName = "OutlinedPathLayer";
  static override defaultProps = {
    ...PathLayer.defaultProps,
    outlineColor: { type: "color" as const, value: [8, 8, 8] },
    fillAlpha: { type: "number" as const, value: 1, min: 0, max: 1 },
    outlineAlpha: { type: "number" as const, value: 1, min: 0, max: 1 },
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
          color.a *= mix(replayOutline.alpha.x, replayOutline.alpha.y * 0.82 * outerCoverage, outlineMix);
          // Fully transparent regions must not hide ribbons behind them.
          if (color.a <= 0.0) discard;
        `,
      },
    };
  }

  override draw(options: Parameters<PathLayer<T>["draw"]>[0]) {
    this.state.model?.shaderInputs.setProps({
      replayOutline: {
        color: (this.props.outlineColor ?? [8, 8, 8]).map((channel) => channel / 255),
        alpha: [this.props.fillAlpha ?? 1, this.props.outlineAlpha ?? 1],
      },
    });
    super.draw(options);
  }
}
