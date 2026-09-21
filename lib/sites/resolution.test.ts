import { describe, expect, it } from "vitest";
import { planSites, type EndpointInput, type SiteCandidate } from "./resolution";
import { newSiteDraft } from "./model";

const input = (key: string, patch: Partial<EndpointInput> = {}): EndpointInput => ({ key, endpoint: "takeoff", name: "North Ridge", lat: 45, lon: 10, ...patch });
const site = (id: string, patch: Partial<SiteCandidate> = {}): SiteCandidate => ({ id, name: "North Ridge", normalizedName: "north ridge", lat: 45, lon: 10, kind: "takeoff", visibility: "private", ownerId: "pilot", boundary: null, updatedAt: new Date("2026-09-01"), ...patch });

describe("shared site resolution", () => {
  it("creates private mapped sites from named coordinates and leaves inputs untouched", () => {
    const original = input("1"); const plan = planSites([original], [], "pilot");
    expect(plan.groups[0].draft).toMatchObject({ name: "North Ridge", lat: 45, lon: 10, visibility: "private" });
    expect(original).toEqual(input("1"));
  });
  it("does not invent names for GPS-only or empty endpoints", () => {
    expect(planSites([input("1", { name: "" }), input("2", { name: "Unknown", lat: null, lon: null })], [], "pilot").groups).toEqual([]);
  });
  it("keeps distant namesakes and coordinate-free rows separate", () => {
    const plan = planSites([input("1"), input("2", { lat: 46 }), input("3", { lat: null, lon: null })], [], "pilot");
    expect(plan.groups).toHaveLength(3);
    expect(plan.resolutions.map(row => row.outcome)).toEqual(["mapped", "mapped", "unmapped"]);
  });
  it("groups nearby rows without chaining beyond the maximum diameter", () => {
    const plan = planSites([input("1"), input("2", { lat: 45.001 }), input("3", { lat: 45.002 })], [], "pilot");
    expect(plan.groups).toHaveLength(2);
    expect([45, 45.001]).toContain(plan.groups[0].draft.lat);
  });
  it("treats takeoff and landing names as separate evidence", () => {
    expect(planSites([input("1"), input("2", { endpoint: "landing" })], [], "pilot").groups).toHaveLength(2);
  });
  it("reuses one unambiguous coordinate match even when the imported label differs", () => {
    expect(planSites([input("1")], [site("a")], "pilot").resolutions[0].siteId).toBe("a");
    expect(planSites([input("1", { name: "Other Ridge" })], [site("a")], "pilot").resolutions[0]).toMatchObject({ siteId: "a", name: "North Ridge", outcome: "existing" });
  });
  it("reuses one exact visible name without coordinates", () => {
    const publicSite = site("public", { visibility: "public", ownerId: "other" });
    expect(planSites([input("1", { lat: null, lon: null })], [publicSite], "pilot").resolutions[0]).toMatchObject({ siteId: "public", name: "North Ridge", outcome: "existing" });
  });
  it("uses an exact name to disambiguate overlapping coordinate matches", () => {
    const plan = planSites([input("1")], [site("a"), site("b", { name: "South Ridge", normalizedName: "south ridge", visibility: "public", ownerId: "other" })], "pilot");
    expect(plan.resolutions[0]).toMatchObject({ siteId: "a", outcome: "existing" });
  });
  it("does not choose among overlapping public and private sites", () => {
    const plan = planSites([input("1")], [site("a"), site("b", { visibility: "public", ownerId: "other" })], "pilot");
    expect(plan.resolutions[0]).toMatchObject({ siteId: null, outcome: "review" });
  });
  it("preserves a user's site selection when GPS disagrees", () => {
    expect(planSites([input("1", { siteId: "a", lat: 50 })], [site("a")], "pilot").resolutions[0]).toMatchObject({ siteId: "a", outcome: "review" });
  });
  it("enriches the selected unmapped site without replacing its identity", () => {
    const plan = planSites([input("1", { siteId: "a" })], [site("a", { lat: null, lon: null })], "pilot");
    expect(plan.groups[0].draft).toMatchObject({ id: "a", lat: 45, lon: 10, visibility: "private" });
  });
  it("leaves conflicting positions for one unmapped site for review", () => {
    const plan = planSites([input("1", { siteId: "a" }), input("2", { siteId: "a", lat: 46 })], [site("a", { lat: null, lon: null })], "pilot");
    expect(plan.groups).toEqual([]);
    expect(plan.resolutions.every(row => row.outcome === "review" && row.siteId === "a")).toBe(true);
  });
  it("preserves deliberate removal even with a matching GPS position", () => {
    expect(planSites([input("1", { cleared: true, name: "" })], [site("a")], "pilot").resolutions[0]).toMatchObject({ siteId: null, outcome: "none" });
  });
  it("rejects unavailable selections and contradictory staged edits", () => {
    expect(() => planSites([input("1", { siteId: "hidden" })], [], "pilot")).toThrow(/available/);
    const draft = { ...newSiteDraft("Ridge"), id: "a" };
    expect(() => planSites([input("1", { draft }), input("2", { draft: { ...draft, name: "Other" } })], [site("a")], "pilot")).toThrow(/different pending edits/);
  });
});
