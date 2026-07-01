import { createHash, randomBytes } from "node:crypto";

export const DEVICE_KEY_PREFIX = "llk_";

export function hashDeviceKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateDeviceKey(): { plaintext: string; hash: string } {
  const plaintext = `${DEVICE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashDeviceKey(plaintext) };
}

export function parseBearer(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^Bearer (llk_[A-Za-z0-9_-]+)$/.exec(headerValue.trim());
  return match?.[1] ?? null;
}
