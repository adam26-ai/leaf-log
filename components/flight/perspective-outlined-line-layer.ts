import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";

const perspectiveLineUniforms = {
  name: "perspectiveLine",
  fs: `layout(std140) uniform perspectiveLineUniforms {
    vec4 outlineColorAndRatio;
  } perspectiveLine;`,
  uniformTypes: {
    outlineColorAndRatio: "vec4<f32>",
  },
} as const;

const CLIP_HELPER = `
bool clipLineSegment(inout vec4 source, inout vec4 target) {
  if (source.w < EPSILON && target.w < EPSILON) {
    return false;
  }

  vec4 originalSource = source;
  vec4 originalTarget = target;
  if (source.w < EPSILON) {
    float ratio = (EPSILON - originalSource.w) / (originalTarget.w - originalSource.w);
    source = mix(originalSource, originalTarget, ratio);
  }
  if (target.w < EPSILON) {
    float ratio = (EPSILON - originalTarget.w) / (originalSource.w - originalTarget.w);
    target = mix(originalTarget, originalSource, ratio);
  }
  return true;
}

`;

function replaceShaderSource(source: string, search: RegExp, replacement: string): string {
  if (!search.test(source)) {
    throw new Error("PerspectiveOutlinedLineLayer could not patch the deck.gl LineLayer shader.");
  }
  return source.replace(search, replacement);
}

/**
 * Bring LineLayer's screen-space extrusion in line with billboarded PathLayer:
 * clip segments at the camera plane, derive direction after perspective divide,
 * and scale pixel offsets by each endpoint's clip-space depth.
 */
export function patchPerspectiveLineVertexShader(source: string): string {
  let patched = replaceShaderSource(
    source,
    /vec3\s+splitLine\s*\(vec3\s+a,\s*vec3\s+b,\s*float\s+x\)\s*\{/,
    `${CLIP_HELPER}vec3 splitLine(vec3 a, vec3 b, float x) {`,
  );
  patched = replaceShaderSource(
    patched,
    /vec4\s+target\s*=\s*project_position_to_clipspace\s*\(\s*target_world\s*,\s*target_world_64low\s*,\s*vec3\s*\(\s*0\.\s*\)\s*,\s*target_commonspace\s*\)\s*;/,
    `  vec4 target = project_position_to_clipspace(target_world, target_world_64low, vec3(0.), target_commonspace);

  if (!clipLineSegment(source, target)) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }`,
  );
  patched = replaceShaderSource(
    patched,
    /getExtrusionOffset\s*\(\s*target\.xy\s*-\s*source\.xy\s*,\s*positions\.y\s*,\s*widthPixels\s*\)/,
    "getExtrusionOffset(target.xy / target.w - source.xy / source.w, positions.y, widthPixels)",
  );
  return replaceShaderSource(
    patched,
    /gl_Position\s*=\s*p\s*\+\s*vec4\s*\(\s*project_pixel_size_to_clipspace\s*\(\s*offset\.xy\s*\)\s*,\s*0\.0\s*,\s*0\.0\s*\)\s*;/,
    "gl_Position = p + vec4(project_pixel_size_to_clipspace(offset.xy) * (p.w / project.focalDistance), 0.0, 0.0);",
  );
}

interface PerspectiveOutlinedLineProps {
  outlineColor?: [number, number, number];
  innerWidthRatio?: number;
}

/** A depth-correct segment whose fill and outline share one rasterized ribbon. */
export class PerspectiveOutlinedLineLayer<T> extends LineLayer<T, PerspectiveOutlinedLineProps> {
  static override layerName = "PerspectiveOutlinedLineLayer";
  static override defaultProps = {
    ...LineLayer.defaultProps,
    outlineColor: { type: "color" as const, value: [8, 8, 8] },
    innerWidthRatio: { type: "number" as const, value: 0.6, min: 0, max: 1 },
  };

  override getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      vs: patchPerspectiveLineVertexShader(shaders.vs),
      modules: [...shaders.modules, perspectiveLineUniforms],
      inject: {
        ...shaders.inject,
        "fs:DECKGL_FILTER_COLOR": `
          float crossLine = abs(geometry.uv.y);
          float antialiasWidth = max(fwidth(crossLine), 0.015);
          float outlineMix = smoothstep(
            perspectiveLine.outlineColorAndRatio.a - antialiasWidth,
            perspectiveLine.outlineColorAndRatio.a + antialiasWidth,
            crossLine
          );
          float outerCoverage = 1.0 - smoothstep(
            1.0 - antialiasWidth * 1.5, 1.0, crossLine
          );
          color.rgb = mix(color.rgb, perspectiveLine.outlineColorAndRatio.rgb, outlineMix);
          color.a *= outerCoverage;
          if (color.a <= 0.0) discard;
        `,
      },
    };
  }

  override draw(options: Parameters<LineLayer<T>["draw"]>[0]) {
    this.state.model?.shaderInputs.setProps({
      perspectiveLine: {
        outlineColorAndRatio: [
          ...(this.props.outlineColor ?? [8, 8, 8]).map((channel) => channel / 255),
          this.props.innerWidthRatio ?? 0.6,
        ],
      },
    });
    super.draw(options);
  }
}

/** Keep pixel-sized join fillers constant as they approach the camera. */
export class ScreenSpaceScatterplotLayer<T> extends ScatterplotLayer<T> {
  static override layerName = "ScreenSpaceScatterplotLayer";

  override getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        ...shaders.inject,
        "vs:DECKGL_FILTER_SIZE": `
          if (scatterplot.billboard) {
            size.xy *= gl_Position.w / project.focalDistance;
          }
        `,
      },
    };
  }
}
