import { describe, it, expect } from "vitest";
import { parseIgc } from "./parse";
import { makeIgc } from "@/test/igc/make-igc";

describe("parseIgc", () => {
  it("parses headers and B-records", () => {
    const igc = makeIgc({
      date: "120724",
      glider: "Ozone Rush",
      pilot: "Jane Doe",
      fixes: [
        { tSec: 36000, lat: 37.8, lon: -122.5, baro: 500, gps: 505 },
        { tSec: 36001, lat: 37.8001, lon: -122.5001, baro: 503, gps: 508 },
      ],
    });
    const { headers, fixes, warnings } = parseIgc(igc);
    expect(headers.glider).toBe("Ozone Rush");
    expect(headers.pilot).toBe("Jane Doe");
    expect(headers.dateMs).toBe(Date.UTC(2024, 6, 12));
    expect(headers.recorder).toContain("Leaf");
    expect(fixes).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("decodes coordinates with sub-metre accuracy", () => {
    const igc = makeIgc({
      fixes: [{ tSec: 36000, lat: 37.812345, lon: -122.498765, baro: 500 }],
    });
    const { fixes } = parseIgc(igc);
    expect(fixes[0].lat).toBeCloseTo(37.812345, 4);
    expect(fixes[0].lon).toBeCloseTo(-122.498765, 4);
  });

  it("corrects UTC midnight rollover", () => {
    const igc = makeIgc({
      fixes: [
        { tSec: 86399, lat: 37.8, lon: -122.5, baro: 500 }, // 23:59:59
        { tSec: 1, lat: 37.8, lon: -122.5, baro: 500 }, // 00:00:01 next day
      ],
    });
    const { fixes } = parseIgc(igc);
    // Second fix must be AFTER the first despite the smaller clock time.
    expect(fixes[1].timeMs).toBeGreaterThan(fixes[0].timeMs);
    expect(fixes[1].timeMs - fixes[0].timeMs).toBe(2000);
  });

  it("treats a zero/stuck baro as absent (GPS fallback possible)", () => {
    const igc = makeIgc({
      fixes: [{ tSec: 36000, lat: 37.8, lon: -122.5, baro: 0, gps: 540 }],
    });
    const { fixes } = parseIgc(igc);
    expect(fixes[0].baroAlt).toBeNull();
    expect(fixes[0].gpsAlt).toBe(540);
  });

  it("drops null-island coordinates and warns", () => {
    const igc = makeIgc({
      fixes: [
        { tSec: 36000, lat: 0, lon: 0, baro: 500 },
        { tSec: 36001, lat: 37.8, lon: -122.5, baro: 500 },
      ],
    });
    const { fixes, warnings } = parseIgc(igc);
    expect(fixes).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/Skipped/);
  });

  it("never throws on garbage input", () => {
    for (const junk of ["", "not an igc file", "B\nBxyz\n\0\0", "HFDTE\nBBBBB"]) {
      expect(() => parseIgc(junk)).not.toThrow();
    }
    const { fixes } = parseIgc("total garbage");
    expect(fixes).toHaveLength(0);
  });

  it("handles a foreign/non-Leaf recorder and unknown records", () => {
    const igc = [
      "AXCS Foreign Logger",
      "HFDTE010120",
      "IXXextra",
      "B0900003748000N12230000WA0050000600",
      "LXSOMECOMMENT",
      "GabcdefSIGNATURE",
    ].join("\n");
    const { headers, fixes } = parseIgc(igc);
    expect(headers.recorder).toContain("Foreign");
    expect(fixes).toHaveLength(1);
  });
});
