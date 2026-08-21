import { describe, it, expect } from "vitest";
import { formatLocationLabel } from "./display";

describe("formatLocationLabel", () => {
  it("renders 'Site — Zone' when both resolve", () => {
    expect(formatLocationLabel("Mission Ridge", "North Launch")).toBe("Mission Ridge — North Launch");
  });

  it("renders just the site name when there is no zone", () => {
    expect(formatLocationLabel("Mission Ridge", null)).toBe("Mission Ridge");
  });

  it("renders null when there is no site name, even if a zone name is present", () => {
    // A zone name without a site name is the site-less case — never
    // rendered bare, so a partially-stripped row can't leak a dangling
    // child name with no parent context.
    expect(formatLocationLabel(null, "North Launch")).toBeNull();
  });

  it("renders null when neither resolves", () => {
    expect(formatLocationLabel(null, null)).toBeNull();
  });
});
