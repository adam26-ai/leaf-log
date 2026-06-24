import sharp, { type Metadata } from "sharp";
import { createHash } from "node:crypto";
import { decodeToBuffer } from "./decode";

/** A rejected file (bad input) — surfaced per-file, never fails the batch. */
export class PhotoError extends Error {}

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB (HEIC can be large)
const MAX_DIM = 12_000; // decoded-dimension guard (image bomb)
const DISPLAY_MAX = 2048; // long edge
const THUMB_MAX = 420;

export interface Variant {
  bytes: Buffer;
  width: number;
  height: number;
}

export interface ProcessedImage {
  /** sha256 over the ORIGINAL bytes — the dedupe key. */
  sha256: string;
  display: Variant;
  thumb: Variant;
}

/**
 * Decode (incl. HEIC), normalize orientation, downscale, and re-encode to
 * sanitized JPEG derivatives (display + thumb). Re-encoding strips ALL EXIF —
 * no originals or metadata are retained. Throws `PhotoError` on bad input.
 */
export async function processImage(
  bytes: Buffer,
  mime: string | null | undefined,
  filename: string,
): Promise<ProcessedImage> {
  if (bytes.length === 0) throw new PhotoError("Empty file");
  if (bytes.length > MAX_INPUT_BYTES) throw new PhotoError("File too large");

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let src: Buffer;
  try {
    src = await decodeToBuffer(bytes, mime, filename);
  } catch {
    throw new PhotoError("Could not decode this image");
  }

  let meta: Metadata;
  try {
    meta = await sharp(src).metadata();
  } catch {
    throw new PhotoError("Unreadable image");
  }
  if (!meta.width || !meta.height) throw new PhotoError("Unreadable image");
  if (meta.width > MAX_DIM || meta.height > MAX_DIM) {
    throw new PhotoError("Image dimensions too large");
  }

  const [display, thumb] = await Promise.all([
    variant(src, DISPLAY_MAX, 82),
    variant(src, THUMB_MAX, 76),
  ]);
  return { sha256, display, thumb };
}

async function variant(src: Buffer, max: number, quality: number): Promise<Variant> {
  const { data, info } = await sharp(src)
    .rotate() // honor EXIF orientation before we strip metadata
    .resize(max, max, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}
