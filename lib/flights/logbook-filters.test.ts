import { expect, it } from "vitest";
import { matchesLogbookFilters, siteKey } from "./logbook-filters";
it("combines filters and distinguishes none from disabled, including unknown sites", () => {
  const flight = { id: "a", takeoffSiteId: null, takeoffSiteName: null, glider: "Wing" };
  expect(siteKey(flight)).toBe("unknown");
  expect(matchesLogbookFilters(flight, ["unknown"], ["Wing"], true, new Set(["a"]))).toBe(true);
  expect(matchesLogbookFilters(flight, [], null, false, new Set())).toBe(false);
  expect(matchesLogbookFilters(flight, null, null, false, new Set())).toBe(true);
  expect(matchesLogbookFilters(flight, ["unknown"], ["Other"], false, new Set())).toBe(false);
  expect(matchesLogbookFilters(flight, null, null, true, new Set())).toBe(false);
});
