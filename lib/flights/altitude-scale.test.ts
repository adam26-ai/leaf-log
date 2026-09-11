import { describe, expect, it } from "vitest";
import { buildAltitudeScale } from "./altitude-scale";

describe("buildAltitudeScale", () => {
  it("uses round thousand-foot ticks while preserving the flight maximum", () => {
    expect(buildAltitudeScale([480, 1_900, 3_514], "imperial")).toEqual({
      domain: [0, 3_514],
      ticks: [0, 1_000, 2_000, 3_000],
    });
  });

  it("uses round metric ticks and includes zero for a low flight", () => {
    expect(buildAltitudeScale([50, 350, 600], "metric")).toEqual({
      domain: [0, 600],
      ticks: [0, 200, 400, 600],
    });
  });

  it("keeps a high-altitude flight expanded around its actual range", () => {
    expect(buildAltitudeScale([5_200, 6_700, 8_800], "imperial")).toEqual({
      domain: [5_200, 8_800],
      ticks: [6_000, 7_000, 8_000],
    });
  });

  it("labels round endpoints when they coincide with the data range", () => {
    expect(buildAltitudeScale([5_000, 9_000], "imperial")).toEqual({
      domain: [5_000, 9_000],
      ticks: [5_000, 6_000, 7_000, 8_000, 9_000],
    });
  });
});
