import type { Accessor, Position } from "@deck.gl/core";
import { LineLayer } from "@deck.gl/layers";

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
const float PERSPECTIVE_LINE_CLIP_EPSILON = 0.000001;
const float PERSPECTIVE_LINE_MITER_LIMIT = 2.0;

bool clipLineSegment(inout vec4 source, inout vec4 target) {
  if (
    source.w < PERSPECTIVE_LINE_CLIP_EPSILON &&
    target.w < PERSPECTIVE_LINE_CLIP_EPSILON
  ) {
    return false;
  }

  vec4 originalSource = source;
  vec4 originalTarget = target;
  if (source.w < PERSPECTIVE_LINE_CLIP_EPSILON) {
    float ratio = (PERSPECTIVE_LINE_CLIP_EPSILON - originalSource.w) /
      (originalTarget.w - originalSource.w);
    source = mix(originalSource, originalTarget, ratio);
  }
  if (target.w < PERSPECTIVE_LINE_CLIP_EPSILON) {
    float ratio = (PERSPECTIVE_LINE_CLIP_EPSILON - originalTarget.w) /
      (originalSource.w - originalTarget.w);
    target = mix(originalTarget, originalSource, ratio);
  }
  return true;
}

vec2 safeLineDirection(vec2 delta, vec2 fallback) {
  float lengthSquared = dot(delta, delta);
  return lengthSquared > 0.00000001
    ? delta * inversesqrt(lengthSquared)
    : fallback;
}

vec2 getMiterOffset(
  vec2 previous,
  vec2 current,
  vec2 following,
  vec2 referenceDirection,
  float side,
  float halfWidthPixels
) {
  vec2 incomingDelta = (current - previous) * project.viewportSize;
  vec2 outgoingDelta = (following - current) * project.viewportSize;
  vec2 incoming = safeLineDirection(incomingDelta, vec2(0.0));
  vec2 outgoing = safeLineDirection(outgoingDelta, incoming);
  incoming = safeLineDirection(incomingDelta, outgoing);

  vec2 tangent = safeLineDirection(incoming + outgoing, referenceDirection);
  vec2 miter = vec2(-tangent.y, tangent.x);
  vec2 referenceNormal = vec2(-referenceDirection.y, referenceDirection.x);
  float alignment = max(abs(dot(miter, referenceNormal)), 1.0 / PERSPECTIVE_LINE_MITER_LIMIT);
  return miter * side * halfWidthPixels / alignment;
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
 * calculate matching miter vertices from each segment's neighbors, and scale
 * pixel offsets by each endpoint's clip-space depth.
 */
export function patchPerspectiveLineVertexShader(source: string): string {
  let patched = replaceShaderSource(
    source,
    /in vec3 instanceTargetPositions64Low;/,
    `in vec3 instanceTargetPositions64Low;
in vec3 instanceSourcePreviousPositions;
in vec3 instanceSourcePreviousPositions64Low;
in vec3 instanceTargetNextPositions;
in vec3 instanceTargetNextPositions64Low;`,
  );
  patched = replaceShaderSource(
    patched,
    /vec3\s+splitLine\s*\(vec3\s+a,\s*vec3\s+b,\s*float\s+x\)\s*\{/,
    `${CLIP_HELPER}vec3 splitLine(vec3 a, vec3 b, float x) {`,
  );
  patched = replaceShaderSource(
    patched,
    /vec4\s+target\s*=\s*project_position_to_clipspace\s*\(\s*target_world\s*,\s*target_world_64low\s*,\s*vec3\s*\(\s*0\.\s*\)\s*,\s*target_commonspace\s*\)\s*;/,
    `  vec4 target = project_position_to_clipspace(target_world, target_world_64low, vec3(0.), target_commonspace);
  vec4 sourcePrevious = project_position_to_clipspace(
    instanceSourcePreviousPositions,
    instanceSourcePreviousPositions64Low,
    vec3(0.)
  );
  vec4 targetNext = project_position_to_clipspace(
    instanceTargetNextPositions,
    instanceTargetNextPositions64Low,
    vec3(0.)
  );

  bool sourceWasClipped = source.w < PERSPECTIVE_LINE_CLIP_EPSILON;
  bool targetWasClipped = target.w < PERSPECTIVE_LINE_CLIP_EPSILON;

  if (!clipLineSegment(source, target)) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  if (sourceWasClipped) {
    sourcePrevious = source;
  } else {
    clipLineSegment(sourcePrevious, source);
  }
  if (targetWasClipped) {
    targetNext = target;
  } else {
    clipLineSegment(targetNext, target);
  }`,
  );
  patched = replaceShaderSource(
    patched,
    /getExtrusionOffset\s*\(\s*target\.xy\s*-\s*source\.xy\s*,\s*positions\.y\s*,\s*widthPixels\s*\)/,
    `positions.x < 0.5
      ? getMiterOffset(
          sourcePrevious.xy / sourcePrevious.w,
          source.xy / source.w,
          target.xy / target.w,
          safeLineDirection((target.xy / target.w - source.xy / source.w) * project.viewportSize, vec2(1.0, 0.0)),
          positions.y,
          widthPixels / 2.0
        )
      : getMiterOffset(
          source.xy / source.w,
          target.xy / target.w,
          targetNext.xy / targetNext.w,
          safeLineDirection((target.xy / target.w - source.xy / source.w) * project.viewportSize, vec2(1.0, 0.0)),
          positions.y,
          widthPixels / 2.0
        )`,
  );
  return replaceShaderSource(
    patched,
    /gl_Position\s*=\s*p\s*\+\s*vec4\s*\(\s*project_pixel_size_to_clipspace\s*\(\s*offset\.xy\s*\)\s*,\s*0\.0\s*,\s*0\.0\s*\)\s*;/,
    "gl_Position = p + vec4(project_pixel_size_to_clipspace(offset.xy) * p.w, 0.0, 0.0);",
  );
}

interface PerspectiveOutlinedLineProps<T> {
  outlineColor?: [number, number, number];
  innerWidthRatio?: number;
  getSourcePreviousPosition?: Accessor<T, Position>;
  getTargetNextPosition?: Accessor<T, Position>;
}

/** A depth-correct segment whose fill and outline share one rasterized ribbon. */
export class PerspectiveOutlinedLineLayer<T> extends LineLayer<T, PerspectiveOutlinedLineProps<T>> {
  static override layerName = "PerspectiveOutlinedLineLayer";
  static override defaultProps = {
    ...LineLayer.defaultProps,
    outlineColor: { type: "color" as const, value: [8, 8, 8] },
    innerWidthRatio: { type: "number" as const, value: 0.6, min: 0, max: 1 },
    getSourcePreviousPosition: { type: "accessor" as const, value: (datum: { sourcePrevious: Position }) => datum.sourcePrevious },
    getTargetNextPosition: { type: "accessor" as const, value: (datum: { targetNext: Position }) => datum.targetNext },
  };

  override initializeState() {
    super.initializeState();
    this.getAttributeManager()?.addInstanced({
      instanceSourcePreviousPositions: {
        size: 3,
        type: "float64",
        fp64: this.use64bitPositions(),
        transition: true,
        accessor: "getSourcePreviousPosition",
      },
      instanceTargetNextPositions: {
        size: 3,
        type: "float64",
        fp64: this.use64bitPositions(),
        transition: true,
        accessor: "getTargetNextPosition",
      },
    });
  }

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
