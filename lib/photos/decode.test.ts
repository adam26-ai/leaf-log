import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { decodeToSharp, isHeic } from "./decode";

// NOTE: the actual HEIC *pixel* decode (heic-convert / libheif-wasm) can't run
// under the vitest harness (WASM BindingError) — it's verified in the real Node
// runtime by `scripts/verify-heic.ts` (the runtime Next.js uses). These tests
// cover the routing/passthrough logic, which is the part vitest can exercise.

describe("isHeic", () => {
  it("detects HEIC/HEIF by mime and by extension", () => {
    expect(isHeic("image/heic")).toBe(true);
    expect(isHeic("image/heif")).toBe(true);
    expect(isHeic("application/octet-stream", "IMG_0001.HEIC")).toBe(true);
    expect(isHeic("image/jpeg", "photo.jpg")).toBe(false);
    expect(isHeic(null, null)).toBe(false);
  });
});

describe("decodeToSharp", () => {
  it("passes JPEG/PNG straight through to sharp (no HEIC path)", async () => {
    const png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: "#888888" },
    })
      .png()
      .toBuffer();
    const img = await decodeToSharp(png, "image/png", "x.png");
    expect((await img.metadata()).width).toBe(12);

    const jpeg = await sharp({
      create: { width: 9, height: 9, channels: 3, background: "#123456" },
    })
      .jpeg()
      .toBuffer();
    const img2 = await decodeToSharp(jpeg, "image/jpeg", "x.jpg");
    expect((await img2.metadata()).width).toBe(9);
  });
});
