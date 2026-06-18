import { createHash } from "node:crypto";

/** SHA-256 of the raw bytes — the per-pilot duplicate-upload key. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
