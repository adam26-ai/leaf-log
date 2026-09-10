import { describe, expect, it } from "vitest";
import { formatAltitude, formatDistance, formatSpeed, formatVario } from "./format";
import { METRIC_UNITS, IMPERIAL_UNITS, readCustomUnits } from "./units";
import { buildAltitudeScale } from "./altitude-scale";

describe("display units", () => {
  it("keeps the existing metric and imperial measurements", () => {
    expect([formatAltitude(1000), formatSpeed(100), formatDistance(5000), formatVario(-2)])
      .toEqual(["1,000 m", "100 km/h", "5.0 km", "-2.0 m/s"]);
    expect([formatAltitude(1000, "imperial"), formatSpeed(100, "imperial"), formatDistance(5000, "imperial"), formatVario(2, "imperial")])
      .toEqual(["3,281 ft", "62 mph", "3.1 mi", "+394 fpm"]);
    expect(formatDistance(100, "imperial")).toBe("328 ft");
  });

  it("mixes each measurement independently, including nautical units", () => {
    const units = { ...METRIC_UNITS, speed: "mph" as const, distance: "nautical-miles" as const, vario: "knots" as const };
    expect(formatAltitude(1234, units)).toBe("1,234 m");
    expect(formatSpeed(100, units)).toBe("62 mph");
    expect(formatDistance(3704, units)).toBe("2.0 nmi");
    expect(formatVario(-1.852, units)).toBe("-3.6 kt");
    expect(formatVario(1.852, units)).toBe("+3.6 kt");
    expect(formatSpeed(18.52, { ...IMPERIAL_UNITS, speed: "knots" })).toBe("10 kt");
    expect(formatDistance(5000, { ...units, distance: "miles" })).toBe("3.1 mi");
    expect(formatVario(null, units)).toBe("—");
  });

  it("uses the custom altitude choice to size the profile axis", () => {
    expect(buildAltitudeScale([400, 600], { ...METRIC_UNITS, altitude: "ft" })).toEqual(buildAltitudeScale([400, 600], "imperial"));
    expect(buildAltitudeScale([400, 600], { ...IMPERIAL_UNITS, altitude: "m" })).toEqual(buildAltitudeScale([400, 600], "metric"));
  });

  it("rejects incomplete or invalid saved choices", () => {
    expect(readCustomUnits({ ...METRIC_UNITS, speed: "mach" })).toBeNull();
    expect(readCustomUnits({ altitude: "m" })).toBeNull();
    expect(readCustomUnits(null)).toBeNull();
    expect(readCustomUnits({ ...METRIC_UNITS, speed: "toString" })).toBeNull();
    expect(readCustomUnits({ ...IMPERIAL_UNITS, extra: true })).toEqual(IMPERIAL_UNITS);
  });
});
