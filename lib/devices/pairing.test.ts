// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  generatePairingCode,
  generatePollHandle,
  hashCode,
  hashHandle,
  normalizeCode,
} from "./pairing";

describe("device pairing helpers", () => {
  it("generates short codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const char of code) {
        expect(PAIRING_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("normalizes typed codes by uppercasing and removing separators", () => {
    expect(normalizeCode("abc-def")).toBe("ABCDEF");
    expect(normalizeCode("abc def")).toBe("ABCDEF");
    expect(normalizeCode(" ab:c_def\n")).toBe("ABCDEF");
  });

  it("hashes codes and poll handles consistently", () => {
    expect(hashCode("abc-def")).toBe(
      "e9c0f8b575cbfcb42ab3b78ecc87efa3b011d9a5d10b09fa4e96f240bf6a82f5",
    );
    expect(hashHandle("handle")).toBe(
      "c2a116aa910d147bd5bdacc2f1cc4430148955f450654ed756e9c93de1b1e1d2",
    );
  });

  it("generates opaque base64url poll handles", () => {
    const first = generatePollHandle();
    const second = generatePollHandle();
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
  });
});
