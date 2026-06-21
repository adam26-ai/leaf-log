/**
 * Generate the raster app icons from app/icon.svg.
 *   pnpm gen:icons
 *
 * Next App Router serves app/icon.svg directly (modern browsers). This produces
 * the legacy favicon.ico and the iOS apple-icon.png from the same source mark.
 */
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync } from "node:fs";

const SVG = readFileSync("app/icon.svg");
const INK = "#141414";

async function png(size: number, flatten = false) {
  let pipe = sharp(SVG, { density: 384 }).resize(size, size);
  if (flatten) pipe = pipe.flatten({ background: INK });
  return pipe.png().toBuffer();
}

async function main() {
  // Legacy favicon.ico (multi-resolution).
  const ico = await pngToIco([await png(16), await png(32), await png(48)]);
  writeFileSync("app/favicon.ico", ico);

  // iOS home-screen icon — full-bleed dark (iOS applies its own rounding).
  writeFileSync("app/apple-icon.png", await png(180, true));

  console.log("wrote app/favicon.ico + app/apple-icon.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
