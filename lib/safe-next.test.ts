import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps clean internal paths", () => {
    expect(safeNext("/logbook")).toBe("/logbook");
    expect(safeNext("/flights/abc?tab=map")).toBe("/flights/abc?tab=map");
  });

  it("falls back for empty / non-path input", () => {
    expect(safeNext("")).toBe("/onboarding");
    expect(safeNext(null)).toBe("/onboarding");
    expect(safeNext(undefined)).toBe("/onboarding");
    expect(safeNext("logbook")).toBe("/onboarding");
  });

  it("rejects external and protocol-relative targets (open-redirect guard)", () => {
    expect(safeNext("https://evil.com")).toBe("/onboarding");
    expect(safeNext("//evil.com")).toBe("/onboarding");
    expect(safeNext("/\\evil.com")).toBe("/onboarding");
  });

  it("rejects the auth/interstitial routes to avoid loops", () => {
    expect(safeNext("/sign-in")).toBe("/onboarding");
    expect(safeNext("/stay-signed-in?next=/logbook")).toBe("/onboarding");
    expect(safeNext("/check-email")).toBe("/onboarding");
  });

  it("honors a custom fallback", () => {
    expect(safeNext("", "/logbook")).toBe("/logbook");
  });
});
