import { createHash, randomBytes, randomInt } from "node:crypto";

export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_TTL_MS = 10 * 60 * 1000;

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCode(rawCode: string): string {
  return sha256Hex(normalizeCode(rawCode));
}

export function generatePollHandle(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHandle(rawPollHandle: string): string {
  return sha256Hex(rawPollHandle);
}
