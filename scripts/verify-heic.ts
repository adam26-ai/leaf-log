/**
 * Verifies HEIC decode works in the real Node runtime (where Next.js route
 * handlers run). libheif-wasm doesn't run under the vitest harness, so this is
 * the decode proof. Run: `node --import tsx scripts/verify-heic.ts`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { decodeToSharp } from "../lib/photos/decode";

const fixture = join(
  process.cwd(),
  "test/photos/fixtures/tiled-sample.heic",
);

async function main() {
  const bytes = readFileSync(fixture);

  // sharp alone rejects the tiled grid (>16 iref security limit) — the reason we
  // route HEIC through heic-convert.
  let sharpFailed = false;
  try {
    await sharp(bytes).jpeg().toBuffer();
  } catch {
    sharpFailed = true;
  }

  const img = await decodeToSharp(bytes, "image/heic", "tiled-sample.heic");
  const out = await img
    .rotate()
    .resize(2048, 2048, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const meta = await sharp(out).metadata();

  if (!meta.width || out.length < 1000) {
    throw new Error("HEIC decode produced an invalid image");
  }
  console.log(
    `OK — sharp-alone failed: ${sharpFailed}; decoded HEIC -> ${meta.width}x${meta.height}, ${out.length} bytes`,
  );
}

main().catch((e) => {
  console.error("HEIC verify FAILED:", e);
  process.exit(1);
});
