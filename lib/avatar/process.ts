import sharp, { type Metadata } from "sharp";
import { decodeToBuffer } from "@/lib/photos/decode";

/** A rejected avatar (bad input). Surfaced to the user, never a 500. */
export class AvatarError extends Error {}

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB (HEIC can be large)
const MAX_DIM = 12_000; // decoded-dimension guard (image bomb)
const FULL = 512; // square avatar long edge
const THUMB = 128; // square thumbnail (header / row avatars)

export interface ProcessedAvatar {
  image: Buffer; // 512x512 JPEG
  thumb: Buffer; // 128x128 JPEG
}

/**
 * Decode (incl. HEIC), honor EXIF orientation, center-crop to a square, and
 * re-encode to sanitized JPEG at two sizes. Re-encoding strips ALL EXIF — no
 * originals or metadata are kept. Throws `AvatarError` on bad input.
 */
export async function processAvatar(
  bytes: Buffer,
  mime: string | null | undefined,
  filename: string,
): Promise<ProcessedAvatar> {
  if (bytes.length === 0) throw new AvatarError("Empty file");
  if (bytes.length > MAX_INPUT_BYTES) throw new AvatarError("File too large");

  let src: Buffer;
  try {
    src = await decodeToBuffer(bytes, mime, filename);
  } catch {
    throw new AvatarError("Could not decode this image");
  }

  let meta: Metadata;
  try {
    meta = await sharp(src).metadata();
  } catch {
    throw new AvatarError("Unreadable image");
  }
  if (!meta.width || !meta.height) throw new AvatarError("Unreadable image");
  if (meta.width > MAX_DIM || meta.height > MAX_DIM) {
    throw new AvatarError("Image dimensions too large");
  }

  const [image, thumb] = await Promise.all([
    square(src, FULL),
    square(src, THUMB),
  ]);
  return { image, thumb };
}

async function square(src: Buffer, size: number): Promise<Buffer> {
  return sharp(src)
    .rotate() // honor EXIF orientation before metadata is stripped
    .resize(size, size, { fit: "cover", position: "attention" })
    .jpeg({ quality: 85 })
    .toBuffer();
}
