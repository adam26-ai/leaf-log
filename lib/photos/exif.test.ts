// @vitest-environment node
// exifr (like heic-convert) needs the Node environment, not jsdom — that's also
// the runtime Next.js route handlers use.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePhotoMeta } from "./exif";

const fixture = join(__dirname, "../../test/photos/fixtures/exif-sample.jpg");

describe("parsePhotoMeta", () => {
  it("reads DateTimeOriginal as naive components + the EXIF offset", async () => {
    const meta = await parsePhotoMeta(readFileSync(fixture));
    expect(meta.takenAtLocal).toEqual({ y: 2026, mo: 6, d: 19, h: 13, mi: 12, s: 11 });
    expect(meta.exifOffsetMinutes).toBe(-420);
    expect(meta.gps).toBeNull(); // this photo carries no GPS
  });

  it("returns nulls for a buffer with no usable EXIF", async () => {
    const meta = await parsePhotoMeta(Buffer.from("not an image at all"));
    expect(meta.takenAtLocal).toBeNull();
    expect(meta.exifOffsetMinutes).toBeNull();
    expect(meta.gps).toBeNull();
  });
});
