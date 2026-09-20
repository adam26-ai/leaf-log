import { describe, expect, it } from "vitest";
import {
  patchPerspectiveLineVertexShader,
  PerspectiveOutlinedLineLayer,
  ScreenSpaceScatterplotLayer,
} from "./perspective-outlined-line-layer";

const STOCK_LINE_SHADER = `
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
    expect(shaders.vs).toContain("clipLineSegment(source, target)");
    expect(shaders.vs).toContain("target.xy / target.w - source.xy / source.w");
    expect(shaders.vs).toContain("p.w / project.focalDistance");
    expect(shaders.inject["fs:DECKGL_FILTER_COLOR"]).toContain("outlineColorAndRatio");
  });

  it("keeps joint fillers at a constant screen-space radius", () => {
    const layer = new ScreenSpaceScatterplotLayer({ id: "test-joints", data: [] });
    (layer as unknown as { context: { defaultShaderModules: [] } }).context = {
      defaultShaderModules: [],
    };

    expect(layer.getShaders().inject["vs:DECKGL_FILTER_SIZE"])
      .toContain("gl_Position.w / project.focalDistance");
  });

  it("clips camera-plane crossings and keeps pixel width independent of depth", () => {
    const shader = patchPerspectiveLineVertexShader(STOCK_LINE_SHADER);

    expect(shader).toContain("bool clipLineSegment(inout vec4 source, inout vec4 target)");
    expect(shader).toContain("if (!clipLineSegment(source, target))");
    expect(shader).toContain("target.xy / target.w - source.xy / source.w");
    expect(shader).toContain("offset.xy) * (p.w / project.focalDistance)");
    expect(shader).not.toContain("getExtrusionOffset(target.xy - source.xy");
  });

  it("fails loudly if a deck.gl upgrade changes the shader contract", () => {
    expect(() => patchPerspectiveLineVertexShader("void main() {}"))
      .toThrow("could not patch the deck.gl LineLayer shader");
  });
});
