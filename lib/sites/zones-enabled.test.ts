import { describe, it, expect, afterEach } from "vitest";
import { zonesEnabled } from "./zones-enabled";

describe("zonesEnabled (SPRINT-008 zone visibility gate)", () => {
  afterEach(() => {
    delete process.env.ZONES_ENABLED;
  });

  it("is false when unset", () => {
    delete process.env.ZONES_ENABLED;
    expect(zonesEnabled()).toBe(false);
  });

  it.each(["", "false", "0", "TRUE", "yes", "1"])("is false for %j", (value) => {
    process.env.ZONES_ENABLED = value;
    expect(zonesEnabled()).toBe(false);
  });

  it('is true only for the literal string "true"', () => {
    process.env.ZONES_ENABLED = "true";
    expect(zonesEnabled()).toBe(true);
  });

  it("reads fresh on every call, not cached at module load", () => {
    delete process.env.ZONES_ENABLED;
    expect(zonesEnabled()).toBe(false);
    process.env.ZONES_ENABLED = "true";
    expect(zonesEnabled()).toBe(true);
    delete process.env.ZONES_ENABLED;
    expect(zonesEnabled()).toBe(false);
  });
});
