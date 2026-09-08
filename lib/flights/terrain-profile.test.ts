import { describe, expect, it } from "vitest";
import { terrainElevationAt, type TerrainProfilePoint } from "./terrain-profile";

describe("terrainElevationAt", () => {
  const terrain: TerrainProfilePoint[] = [
    [0, 500],
    [10, 700],
    [30, 600],
  ];

  it("returns recorded terrain heights at exact timestamps", () => {
    expect(terrainElevationAt(terrain, 10)).toBe(700);
  });

  it("interpolates terrain to the barograph timeline", () => {
    expect(terrainElevationAt(terrain, 5)).toBe(600);
    expect(terrainElevationAt(terrain, 20)).toBe(650);
  });

  it("leaves points outside the sampled terrain range empty", () => {
    expect(terrainElevationAt(terrain, -1)).toBeUndefined();
    expect(terrainElevationAt(terrain, 31)).toBeUndefined();
  });
});
