import { describe, it, expect } from "vitest";
import { normalizeSiteVisibility, canSeeSite, canSeeZone } from "./visibility";

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

describe("canSeeZone — the conjunction with its parent, full truth table", () => {
  const SITE_ID = "site-1";
  const OTHER_SITE_ID = "site-2";
  const SITE_OWNER = "site-owner";
  const ZONE_OWNER = "zone-owner";
  const STRANGER = "stranger";

  function zone(visibility: "public" | "private", ownerId: string | null, siteId = SITE_ID) {
    return { visibility, ownerId, siteId };
  }
  function site(visibility: "public" | "private", ownerId: string | null, id = SITE_ID) {
    return { id, visibility, ownerId };
  }

  it("public site, public zone: visible to everyone, including no viewer", () => {
    const z = zone("public", ZONE_OWNER);
    const s = site("public", SITE_OWNER);
    for (const viewerId of [ZONE_OWNER, SITE_OWNER, STRANGER, null]) {
      expect(canSeeZone(z, s, viewerId)).toBe(true);
    }
  });

  it("public site, private zone: visible only to the zone's own owner", () => {
    const z = zone("private", ZONE_OWNER);
    const s = site("public", SITE_OWNER);
    expect(canSeeZone(z, s, ZONE_OWNER)).toBe(true);
    expect(canSeeZone(z, s, SITE_OWNER)).toBe(false);
    expect(canSeeZone(z, s, STRANGER)).toBe(false);
    expect(canSeeZone(z, s, null)).toBe(false);
  });

  it("private site, public zone (the incoherent row): visible only to the SITE's owner, regardless of the zone's own owner", () => {
    // Refused at create time (see docs/sprints/SPRINT-005.md); this proves
    // the READ-time neutralization holds independently if the row exists
    // anyway (a hand-written row, a future bug reachable some other way).
    const z = zone("public", ZONE_OWNER);
    const s = site("private", SITE_OWNER);
    expect(canSeeZone(z, s, SITE_OWNER)).toBe(true);
    // The zone's own owner does NOT get a pass — the parent gate is checked
    // first and fails for anyone but the SITE's owner.
    expect(canSeeZone(z, s, ZONE_OWNER)).toBe(false);
    expect(canSeeZone(z, s, STRANGER)).toBe(false);
    expect(canSeeZone(z, s, null)).toBe(false);
  });

  it("private site, private zone: visible only to a viewer who is BOTH the site's and the zone's owner", () => {
    const z = zone("private", ZONE_OWNER);
    const s = site("private", SITE_OWNER);
    // Not even the site's own owner can see a zone privately owned by a
    // DIFFERENT pilot under their own site — independent ownership means
    // independent visibility, not an inherited override.
    expect(canSeeZone(z, s, SITE_OWNER)).toBe(false);
    expect(canSeeZone(z, s, ZONE_OWNER)).toBe(false);
    expect(canSeeZone(z, s, STRANGER)).toBe(false);
    expect(canSeeZone(z, s, null)).toBe(false);

    // The one case where they coincide: a pilot who owns both.
    const zSameOwner = zone("private", SITE_OWNER);
    expect(canSeeZone(zSameOwner, s, SITE_OWNER)).toBe(true);
  });

  it("fails closed when the parent site is missing (orphan)", () => {
    const z = zone("public", ZONE_OWNER);
    expect(canSeeZone(z, null, ZONE_OWNER)).toBe(false);
  });

  it("fails closed when the zone's siteId disagrees with the given site's id (mismatch)", () => {
    const z = zone("public", ZONE_OWNER, SITE_ID);
    const s = site("public", SITE_OWNER, OTHER_SITE_ID);
    expect(canSeeZone(z, s, ZONE_OWNER)).toBe(false);
  });

  it("an orphaned private zone (null owner) is invisible to everyone, even under a public site", () => {
    const z = zone("private", null);
    const s = site("public", SITE_OWNER);
    expect(canSeeZone(z, s, STRANGER)).toBe(false);
    expect(canSeeZone(z, s, null)).toBe(false);
  });
});
