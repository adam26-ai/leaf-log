// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateDeviceKey, hashDeviceKey, parseBearer } from "./token";

describe("device token helpers", () => {
  it("generates unique llk-prefixed keys", () => {
    const first = generateDeviceKey();
    const second = generateDeviceKey();

    expect(first.plaintext).toMatch(/^llk_[A-Za-z0-9_-]+$/);
    expect(second.plaintext).toMatch(/^llk_[A-Za-z0-9_-]+$/);
    expect(first.plaintext).not.toBe(second.plaintext);
    expect(first.hash).not.toBe(second.hash);
  });

  it("hashes generated plaintext consistently", () => {
    const key = generateDeviceKey();
    expect(hashDeviceKey(key.plaintext)).toBe(key.hash);
  });

  it("parses bearer device keys", () => {
    const key = generateDeviceKey();
    expect(parseBearer(`Bearer ${key.plaintext}`)).toBe(key.plaintext);
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer(key.plaintext)).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer abc")).toBeNull();
    expect(parseBearer(`Bearer ${key.plaintext} extra`)).toBeNull();
  });
});
