import { describe, it, expect } from "vitest";
import { normalizeSiteVisibility, canSeeSite } from "./visibility";

describe("normalizeSiteVisibility", () => {
  it("passes through known values", () => {
    expect(normalizeSiteVisibility("private")).toBe("private");
    expect(normalizeSiteVisibility("public")).toBe("public");
  });

  it("fails closed to private on anything unrecognized", () => {
    expect(normalizeSiteVisibility("friends")).toBe("private");
    expect(normalizeSiteVisibility(undefined)).toBe("private");
    expect(normalizeSiteVisibility(null)).toBe("private");
    expect(normalizeSiteVisibility("")).toBe("private");
    expect(normalizeSiteVisibility(42)).toBe("private");
  });
});

describe("canSeeSite — truth table", () => {
  const OWNER = "owner-1";
  const OTHER = "other-2";

  it("a public site is visible to anyone, including no viewer", () => {
    expect(canSeeSite("public", OWNER, OWNER)).toBe(true);
    expect(canSeeSite("public", OWNER, OTHER)).toBe(true);
    expect(canSeeSite("public", OWNER, null)).toBe(true);
    expect(canSeeSite("public", null, null)).toBe(true);
    expect(canSeeSite("public", null, OTHER)).toBe(true);
  });

  it("a private site is visible only to its owner", () => {
    expect(canSeeSite("private", OWNER, OWNER)).toBe(true);
  });

  it("a private site is invisible to a stranger", () => {
    expect(canSeeSite("private", OWNER, OTHER)).toBe(false);
  });

  it("a private site is invisible to an anonymous viewer", () => {
    expect(canSeeSite("private", OWNER, null)).toBe(false);
  });

  it("an orphaned private site (null owner) is invisible to everyone, viewerId included", () => {
    expect(canSeeSite("private", null, OTHER)).toBe(false);
    expect(canSeeSite("private", null, null)).toBe(false);
    // Even a null viewerId that happens to equal the null ownerId must not match.
    expect(canSeeSite("private", null, OWNER)).toBe(false);
  });
});
