import { expect, it } from "vitest";
import { altitudeAnchorY, cameraSpring, chaseCourse, trackingFrequency } from "./replay-camera";
import type { Sample } from "@/lib/igc/interpolate";

it("holds direction through a thermal but follows straight travel", () => {
  const circle: Sample[] = Array.from({ length: 121 }, (_, i) => [Math.cos(i * Math.PI / 15) * 0.001, Math.sin(i * Math.PI / 15) * 0.001, 1000, i]);
  expect(chaseCourse(circle, 90)).toBeNull();
  const straight: Sample[] = Array.from({ length: 121 }, (_, i) => [i * 0.0001, 0, 1000, i]);
  expect(chaseCourse(straight, 90)).toBeCloseTo(90);
  expect(chaseCourse([[0, 0, 1000, 0], [0.01, 0, 1000, 100]], 100)).toBeNull();
});
it("recognizes a thermal exit before travelling 300 metres", () => {
  const circle: Sample[] = Array.from({ length: 61 }, (_, i) => [Math.cos(i * Math.PI / 15) * 0.001, Math.sin(i * Math.PI / 15) * 0.001, 1000, i]);
  const exit: Sample[] = Array.from({ length: 12 }, (_, i) => [0.001 + (i + 1) * 0.0001, 0, 1000, 61 + i]);
  expect(chaseCourse([...circle, ...exit], 72)).toBeCloseTo(90);
});
it("spring motion accelerates and settles without overshooting a stationary target", () => {
  let position = 0, velocity = 0;
  const steps: number[] = [];
  for (let i = 0; i < 180; i++) {
    [position, velocity] = cameraSpring(position, velocity, 100, 1 / 60, 8);
    steps.push(position);
    expect(position).toBeLessThanOrEqual(100);
  }
  expect(steps[1] - steps[0]).toBeGreaterThan(steps[0]);
  expect(position).toBeCloseTo(100, 4);
  expect(Math.abs(velocity)).toBeLessThan(0.001);
});
it("spring movement is frame-rate independent and catches up faster when far behind", () => {
  function move(hz: number, frequency: number) {
    let position = 0, velocity = 0;
    for (let i = 0; i < hz / 2; i++) [position, velocity] = cameraSpring(position, velocity, 100, 1 / hz, frequency);
    return position;
  }
  expect(move(30, 8)).toBeCloseTo(move(120, 8), 8);
  expect(move(60, trackingFrequency(160))).toBeGreaterThan(move(60, trackingFrequency(0)));
});
it("keeps lag bounded for a fast moving target at different render rates", () => {
  for (const hz of [15, 30, 60]) {
    let position = 0, velocity = 0;
    for (let i = 1; i <= hz * 5; i++) {
      const target = i / hz * 150;
      [position, velocity] = cameraSpring(position, velocity, target, 1 / hz, trackingFrequency(target - position));
      expect(target - position).toBeLessThan(40);
    }
  }
});
it("keeps low and high pilot positions between bottom and badge clearance", () => {
  expect(altitudeAnchorY(0, 0, 1000, 600, 180, false)).toBeCloseTo(528);
  expect(altitudeAnchorY(1000, 0, 1000, 600, 180, false)).toBe(268);
  expect(altitudeAnchorY(500, 0, 1000, 600, 180, false)).toBe(398);
  expect(Number.isFinite(altitudeAnchorY(100, 100, 100, 460, 100, true))).toBe(true);
});
