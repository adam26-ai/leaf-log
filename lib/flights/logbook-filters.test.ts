import { expect, it } from "vitest";
import { matchesLogbookFilters, readLogbookFilters, siteKey } from "./logbook-filters";
it("combines filters and distinguishes none from disabled, including unknown sites", () => {
  const flight = { id: "a", takeoffSiteId: null, takeoffSiteName: null, glider: "Wing" };
  expect(siteKey(flight)).toBe("unknown");
  expect(matchesLogbookFilters(flight, ["unknown"], ["Wing"], true, new Set(["a"]))).toBe(true);
  expect(matchesLogbookFilters(flight, [], null, false, new Set())).toBe(false);
  expect(matchesLogbookFilters(flight, null, null, false, new Set())).toBe(true);
  expect(matchesLogbookFilters(flight, ["unknown"], ["Other"], false, new Set())).toBe(false);
  expect(matchesLogbookFilters(flight, null, null, true, new Set())).toBe(false);
});

it("normalizes retired friend and trophy choices while preserving site and wing deselection", () => {
  expect(readLogbookFilters(JSON.stringify({ sites: [], wings: [], friends: ["__no_shared_flights__"], trophies: ["none"] }))).toMatchObject({ sites: [], wings: [], friends: null, trophiesOnly: false });
  expect(readLogbookFilters(JSON.stringify({ friends: ["__no_shared_flights__", "alice"], trophies: ["altitude"] }))).toMatchObject({ friends: ["alice"], trophiesOnly: true });
  expect(readLogbookFilters(JSON.stringify({ friends: [], trophies: [] }))).toMatchObject({ friends: null, trophiesOnly: false });
  expect(readLogbookFilters(JSON.stringify({ trophiesOnly: false, trophies: ["any"] })).trophiesOnly).toBe(false);
});
