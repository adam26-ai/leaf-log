import { describe, it, expect } from "vitest";
import { localToUtcMs, parseExifDateTime, parseExifOffset } from "./time";

describe("localToUtcMs", () => {
  it("bridges local components to UTC for negative/zero/positive offsets", () => {
    const c = { y: 2026, mo: 6, d: 19, h: 13, mi: 0, s: 0 };
    // UTC-7: 13:00 local => 20:00Z
    expect(localToUtcMs(c, -420)).toBe(Date.UTC(2026, 5, 19, 20, 0, 0));
    // UTC: unchanged
    expect(localToUtcMs(c, 0)).toBe(Date.UTC(2026, 5, 19, 13, 0, 0));
    // UTC+5:30: 13:00 local => 07:30Z
    expect(localToUtcMs(c, 330)).toBe(Date.UTC(2026, 5, 19, 7, 30, 0));
  });

  it("does not depend on the server timezone (pure component math)", () => {
    const c = { y: 2020, mo: 1, d: 1, h: 0, mi: 0, s: 0 };
    expect(localToUtcMs(c, 0)).toBe(Date.UTC(2020, 0, 1, 0, 0, 0));
  });
});

describe("parseExifDateTime", () => {
  it("parses the standard EXIF format and sub-seconds", () => {
    expect(parseExifDateTime("2026:06:19 13:12:11")).toEqual({
      y: 2026, mo: 6, d: 19, h: 13, mi: 12, s: 11,
    });
    expect(parseExifDateTime("2026:06:19 13:12:11.500")).toEqual({
      y: 2026, mo: 6, d: 19, h: 13, mi: 12, s: 11,
    });
    expect(parseExifDateTime("2026-06-19T13:12:11")).toEqual({
      y: 2026, mo: 6, d: 19, h: 13, mi: 12, s: 11,
    });
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseExifDateTime("")).toBeNull();
    expect(parseExifDateTime("not a date")).toBeNull();
    expect(parseExifDateTime("2026:13:19 13:12:11")).toBeNull(); // month 13
    expect(parseExifDateTime(undefined)).toBeNull();
    expect(parseExifDateTime(12345)).toBeNull();
  });
});

describe("parseExifOffset", () => {
  it("parses signed offsets and Z", () => {
    expect(parseExifOffset("+07:00")).toBe(420);
    expect(parseExifOffset("-08:00")).toBe(-480);
    expect(parseExifOffset("+0530")).toBe(330);
    expect(parseExifOffset("Z")).toBe(0);
  });
  it("returns null for absent/garbage", () => {
    expect(parseExifOffset(undefined)).toBeNull();
    expect(parseExifOffset("nope")).toBeNull();
  });
});
