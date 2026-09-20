import { describe, expect, it } from "vitest";
import {
  patchPerspectiveLineVertexShader,
  PerspectiveOutlinedLineLayer,
} from "./perspective-outlined-line-layer";

const STOCK_LINE_SHADER = `
in vec3 instanceTargetPositions64Low;
vec3 splitLine(vec3 a, vec3 b, float x) {
}
void main(void) {
  vec4 target = project_position_to_clipspace(target_world, target_world_64low, vec3(0.), target_commonspace);
  vec3 offset = vec3(
    getExtrusionOffset(target.xy - source.xy, positions.y, widthPixels),
    0.0);
  gl_Position = p + vec4(project_pixel_size_to_clipspace(offset.xy), 0.0, 0.0);
}
`;

describe("patchPerspectiveLineVertexShader", () => {
  it("patches the installed deck.gl runtime shader", () => {
    const layer = new PerspectiveOutlinedLineLayer({ id: "test", data: [] });
    (layer as unknown as { context: { defaultShaderModules: [] } }).context = {
      defaultShaderModules: [],
    };

    const shaders = layer.getShaders();
    expect(shaders.vs).toContain("const float PERSPECTIVE_LINE_CLIP_EPSILON = 0.000001;");
    expect(shaders.vs).not.toMatch(/\bEPSILON\b/);
    expect(shaders.vs).toContain("clipLineSegment(source, target)");
    expect(shaders.vs).toContain("instanceSourcePreviousPositions");
    expect(shaders.vs).toContain("instanceTargetNextPositions");
    expect(shaders.vs).toContain("getMiterOffset(");
    expect(shaders.vs).toContain("PERSPECTIVE_LINE_MITER_LIMIT = 1.35");
    expect(shaders.vs).toContain("PERSPECTIVE_LINE_MIN_DIRECTION_PIXELS = 0.5");
    expect(shaders.vs).toContain("(following - previous) * project.viewportSize");
    expect(shaders.vs).toContain("project_pixel_size_to_clipspace(offset.xy) * p.w");
    expect(shaders.vs).not.toContain("p.w / project.focalDistance");
    expect(shaders.inject["fs:DECKGL_FILTER_COLOR"]).toContain("outlineColorAndRatio");
  });

  it("clips camera-plane crossings and keeps pixel width independent of depth", () => {
    const shader = patchPerspectiveLineVertexShader(STOCK_LINE_SHADER);

    expect(shader).toContain("const float PERSPECTIVE_LINE_CLIP_EPSILON = 0.000001;");
    expect(shader).not.toMatch(/\bEPSILON\b/);
    expect(shader).toContain("bool clipLineSegment(inout vec4 source, inout vec4 target)");
    expect(shader).toContain("if (!clipLineSegment(source, target))");
    expect(shader).toContain("sourcePrevious.xy / sourcePrevious.w");
    expect(shader).toContain("targetNext.xy / targetNext.w");
    expect(shader).toContain("widthPixels / 2.0");
    expect(shader).toContain("offset.xy) * p.w");
    expect(shader).not.toContain("p.w / project.focalDistance");
    expect(shader).not.toContain("getExtrusionOffset(target.xy - source.xy");
  });

  it("fails loudly if a deck.gl upgrade changes the shader contract", () => {
    expect(() => patchPerspectiveLineVertexShader("void main() {}"))
      .toThrow("could not patch the deck.gl LineLayer shader");
  });
});
