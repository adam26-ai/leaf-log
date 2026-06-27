import sharp from "sharp";
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
 * A user-chosen crop region, as fractions of the EXIF-oriented image: `x`/`w`
 * relative to width, `y`/`h` relative to height. The region is square in pixels
 * (`w * width ≈ h * height`); it comes from the client's pan/zoom cropper.
 */
export interface AvatarCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Decode (incl. HEIC), honor EXIF orientation, crop to a square, and re-encode
 * to sanitized JPEG at two sizes. With `crop`, the user's pan/zoom selection is
 * extracted; without it, sharp's attention-based center-crop is used. Re-encoding
 * strips ALL EXIF — no originals or metadata are kept. Throws `AvatarError` on
 * bad input.
 */
export async function processAvatar(
  bytes: Buffer,
  mime: string | null | undefined,
  filename: string,
  crop?: AvatarCrop,
): Promise<ProcessedAvatar> {
  if (bytes.length === 0) throw new AvatarError("Empty file");
  if (bytes.length > MAX_INPUT_BYTES) throw new AvatarError("File too large");

  let src: Buffer;
  try {
    src = await decodeToBuffer(bytes, mime, filename);
  } catch {
    throw new AvatarError("Could not decode this image");
  }

  // Orient once up front so the crop rect (computed against the oriented image
  // the user saw) and the dimension guard both use post-rotation pixels.
  let oriented: Buffer;
  let width: number;
  let height: number;
  try {
    const out = await sharp(src).rotate().toBuffer({ resolveWithObject: true });
    oriented = out.data;
    width = out.info.width;
    height = out.info.height;
  } catch {
    throw new AvatarError("Unreadable image");
  }
  if (!width || !height) throw new AvatarError("Unreadable image");
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new AvatarError("Image dimensions too large");
  }

  let working = oriented;
  if (crop) {
    const rect = clampRect(crop, width, height);
    working = await sharp(oriented).extract(rect).toBuffer();
  }

  const [image, thumb] = await Promise.all([
    square(working, FULL, !!crop),
    square(working, THUMB, !!crop),
  ]);
  return { image, thumb };
}

/** Map a normalized crop to an integer pixel rect clamped inside the image. */
function clampRect(crop: AvatarCrop, width: number, height: number) {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const left = Math.round(clamp01(crop.x) * width);
  const top = Math.round(clamp01(crop.y) * height);
  const w = Math.max(1, Math.min(width - left, Math.round(clamp01(crop.w) * width)));
  const h = Math.max(1, Math.min(height - top, Math.round(clamp01(crop.h) * height)));
  return { left, top, width: w, height: h };
}

async function square(src: Buffer, size: number, cropped: boolean): Promise<Buffer> {
  // `src` is already EXIF-oriented (and, when cropped, already square). A manual
  // crop uses centre gravity (no smart re-crop); otherwise fall back to attention.
  return sharp(src)
    .resize(size, size, { fit: "cover", position: cropped ? "centre" : "attention" })
    .jpeg({ quality: 85 })
    .toBuffer();
}
