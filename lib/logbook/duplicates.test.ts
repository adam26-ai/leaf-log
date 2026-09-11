import { describe, expect, it } from "vitest";
import { overlappingFlightTimes, possibleDuplicate, possibleIgcDuplicate, type DuplicateFlight } from "./duplicates";

const flight = (patch: Partial<DuplicateFlight> = {}): DuplicateFlight => ({
  id: "flight",
  flightDate: new Date("2024-07-13T00:00:00.000Z"),
  takeoffAt: new Date("2024-07-13T23:58:00.000Z"),
  landingAt: new Date("2024-07-14T00:12:00.000Z"),
  localUtcOffsetMinutes: 0,
  durationS: 840,
  glider: "Wing A",
  takeoffSiteName: "Coast",
  ...patch,
});

describe("overlapping flight additions", () => {
  it("flags any real interval overlap despite conflicting dates, locations, and wings", () => {
    const existing = flight();
    const incoming = flight({
      id: "incoming",
      flightDate: new Date("2024-07-14T00:00:00.000Z"),
      takeoffAt: new Date("2024-07-14T00:05:00.000Z"),
      landingAt: new Date("2024-07-14T00:20:00.000Z"),
      takeoffSiteName: "Different continent",
      glider: "Wing B",
    });

    expect(overlappingFlightTimes(existing, incoming)).toBe(true);
    expect(possibleDuplicate(existing, incoming)).toBe(true);
    expect(possibleIgcDuplicate(existing, incoming)).toBe(true);
  });

  it("does not flag flights whose intervals merely touch or do not overlap", () => {
    const existing = flight();
    const touching = flight({
      id: "touching",
      takeoffAt: new Date("2024-07-14T00:12:00.000Z"),
      landingAt: new Date("2024-07-14T00:30:00.000Z"),
    });
    const later = flight({
      id: "later",
      takeoffAt: new Date("2024-07-14T01:00:00.000Z"),
      landingAt: new Date("2024-07-14T01:14:00.000Z"),
    });

    expect(overlappingFlightTimes(existing, touching)).toBe(false);
    expect(possibleDuplicate(existing, touching)).toBe(false);
    expect(possibleIgcDuplicate(existing, later)).toBe(false);
  });

  it("flags a known takeoff instant that falls inside another flight", () => {
    const existing = flight();
    const incoming = flight({
      id: "incoming",
      takeoffAt: new Date("2024-07-14T00:05:00.000Z"),
      landingAt: null,
      durationS: null,
    });

    expect(overlappingFlightTimes(existing, incoming)).toBe(true);
    expect(possibleDuplicate(existing, incoming)).toBe(true);
  });

  it("retains the conservative same-day fallback when a flight has no usable times", () => {
    const untimed = flight({ takeoffAt: null, landingAt: null });
    const incoming = flight({ id: "incoming", takeoffAt: null, landingAt: null });
    expect(overlappingFlightTimes(untimed, incoming)).toBeNull();
    expect(possibleDuplicate(untimed, incoming)).toBe(true);
  });
});
