import { expect, it } from "vitest";
import { altitudeAnchorY, chaseCourse } from "./replay-camera";
import type { Sample } from "@/lib/igc/interpolate";

it("holds direction through a thermal but follows 500m of straight travel", () => {
  const circle: Sample[] = Array.from({ length: 121 }, (_, i) => [Math.cos(i * Math.PI / 15) * 0.001, Math.sin(i * Math.PI / 15) * 0.001, 1000, i]);
  expect(chaseCourse(circle, 90)).toBeNull();
  const straight: Sample[] = Array.from({ length: 121 }, (_, i) => [i * 0.0001, 0, 1000, i]);
  expect(chaseCourse(straight, 90)).toBeCloseTo(90);
  expect(chaseCourse([[0, 0, 1000, 0], [0.01, 0, 1000, 100]], 100)).toBeNull();
});
it("keeps low and high pilot positions between bottom and badge clearance", () => {
  expect(altitudeAnchorY(0, 0, 1000, 600, 180, false)).toBeCloseTo(528);
  expect(altitudeAnchorY(1000, 0, 1000, 600, 180, false)).toBe(268);
  expect(altitudeAnchorY(500, 0, 1000, 600, 180, false)).toBe(398);
  expect(Number.isFinite(altitudeAnchorY(100, 100, 100, 460, 100, true))).toBe(true);
});
