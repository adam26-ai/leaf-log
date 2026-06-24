import { describe, it, expect } from "vitest";
import { placePhoto } from "./placement";
import type { FlightPlacementContext, PhotoMeta } from "./types";
import type { Sample } from "@/lib/igc/interpolate";

// Linear track: takeoff 13:00 local (UTC-7) = 20:00Z, 600 s long.
const TAKEOFF_MS = Date.UTC(2026, 5, 19, 20, 0, 0);
const samples: Sample[] = [
  [-121.0, 37.0, 1000, 0],
  [-121.1, 37.1, 1500, 300],
  [-121.2, 37.2, 1200, 600],
];
const ctx: FlightPlacementContext = {
  takeoffMs: TAKEOFF_MS,
  durationS: 600,
  bounds: [-121.2, 37.0, -121.0, 37.2], // w,s,e,n
  localUtcOffsetMinutes: -420,
};

const meta = (over: Partial<PhotoMeta> = {}): PhotoMeta => ({
  takenAtLocal: null,
  exifOffsetMinutes: null,
  gps: null,
  ...over,
});

describe("placePhoto — timestamp placement", () => {
  it("interpolates position from capture time bridged via the flight offset", () => {
    // 13:05:00 local => 20:05:00Z => tSec 300 => sample[1]
    const p = placePhoto(
      meta({ takenAtLocal: { y: 2026, mo: 6, d: 19, h: 13, mi: 5, s: 0 } }),
      ctx,
      samples,
    );
    expect(p.source).toBe("interpolated_time");
    expect(p.tSec).toBe(300);
    expect(p.lon).toBeCloseTo(-121.1, 6);
    expect(p.lat).toBeCloseTo(37.1, 6);
    expect(p.altM).toBe(1500);
    expect(p.takenAtMs).toBe(Date.UTC(2026, 5, 19, 20, 5, 0));
  });

  it("leaves a photo taken before/after the flight unpinned (no clamp)", () => {
    const before = placePhoto(
      meta({ takenAtLocal: { y: 2026, mo: 6, d: 19, h: 12, mi: 50, s: 0 } }),
      ctx,
      samples,
    );
    expect(before.source).toBe("unpinned");
    expect(before.failureReason).toBe("out_of_window");
    expect(before.lat).toBeNull();
    expect(before.takenAtMs).not.toBeNull();
  });

  it("is unpinned with no usable time and no GPS", () => {
    const p = placePhoto(meta(), ctx, samples);
    expect(p.source).toBe("unpinned");
    expect(p.failureReason).toBe("no_time");
  });

  it("is unpinned when the flight has no UTC offset (never guesses)", () => {
    const p = placePhoto(
      meta({ takenAtLocal: { y: 2026, mo: 6, d: 19, h: 13, mi: 5, s: 0 } }),
      { ...ctx, localUtcOffsetMinutes: null },
      samples,
    );
    expect(p.failureReason).toBe("missing_flight_offset");
  });
});

describe("placePhoto — GPS", () => {
  it("uses sanity-checked GPS as the override, with tSec when a time exists", () => {
    const p = placePhoto(
      meta({
        gps: { lat: 37.15, lon: -121.05, altM: 1600 },
        takenAtLocal: { y: 2026, mo: 6, d: 19, h: 13, mi: 5, s: 0 },
      }),
      ctx,
      samples,
    );
    expect(p.source).toBe("exif_gps");
    expect(p.lat).toBe(37.15);
    expect(p.lon).toBe(-121.05);
    expect(p.altM).toBe(1600);
    expect(p.tSec).toBe(300);
  });

  it("rejects out-of-bounds GPS and falls back to the timestamp", () => {
    const p = placePhoto(
      meta({
        gps: { lat: 50, lon: 10, altM: null },
        takenAtLocal: { y: 2026, mo: 6, d: 19, h: 13, mi: 5, s: 0 },
      }),
      ctx,
      samples,
    );
    expect(p.source).toBe("interpolated_time");
    expect(p.tSec).toBe(300);
  });

  it("is unpinned (bad_gps) when GPS is implausible and there is no time", () => {
    const p = placePhoto(meta({ gps: { lat: 50, lon: 10, altM: null } }), ctx, samples);
    expect(p.source).toBe("unpinned");
    expect(p.failureReason).toBe("bad_gps");
  });

  it("places by GPS even with no usable time (tSec null)", () => {
    const p = placePhoto(meta({ gps: { lat: 37.1, lon: -121.1, altM: null } }), ctx, samples);
    expect(p.source).toBe("exif_gps");
    expect(p.tSec).toBeNull();
  });
});
