import sharp, { type Sharp } from "sharp";
import heicConvert from "heic-convert";

const HEIC_MIME = /^image\/(heic|heif)(-sequence)?$/i;

/** True for HEIC/HEIF input (by MIME or file extension). */
export function isHeic(mime: string | null | undefined, filename?: string | null): boolean {
  return HEIC_MIME.test(mime ?? "") || /\.(heic|heif)$/i.test(filename ?? "");
}

/**
 * Decode supported image input (JPEG / PNG / HEIC) into a `sharp` pipeline ready
 * for rotate/resize/encode.
 *
 * HEIC is decoded via `heic-convert` (pure-JS libheif-wasm) rather than sharp:
 * iPhones store HEIC as a tiled grid, and sharp's bundled libheif rejects those
 * at its 16-reference security limit ("Number of references in iref box (N)
 * exceeds the security limits"). `heic-convert` handles tiled HEIC and, being
 * WASM, behaves identically on the Railway image (no native libheif needed).
 * See docs/sprints/drafts/SPRINT-002-PR0-HEIC-SPIKE.md.
 */
export async function decodeToSharp(
  bytes: Buffer,
  mime: string | null | undefined,
  filename?: string | null,
): Promise<Sharp> {
  if (isHeic(mime, filename)) {
    const jpeg = await heicConvert({ buffer: bytes, format: "JPEG", quality: 0.92 });
    return sharp(Buffer.from(jpeg));
  }
  return sharp(bytes);
}
