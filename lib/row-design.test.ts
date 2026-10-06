import { expect, it } from "vitest";
import { defaultRowDesign, layoutRow, parseRowDesign } from "./row-design";

it("reclaims disabled, absent and threshold-hidden columns without hiding anything else", () => {
  const design = defaultRowDesign("feed");
  design.columns.find(c => c.id === "altitude")!.drop = 800;
  const at = layoutRow(design, 800);
  const below = layoutRow(design, 799, ["friends", "trophies"]);
  expect(at.columns.some(c => c.id === "altitude")).toBe(true);
  expect(below.columns.some(c => ["altitude", "friends", "trophies"].includes(c.id))).toBe(false);
  expect(below.columns.some(c => c.id === "kudos")).toBe(true);
  expect(below.columns.at(-1)?.after).toBe(0);
});
it("allocates percentage widths and shares only remaining space with flex columns", () => {
  const design = defaultRowDesign("feed");
  design.padding = 9;
  design.columns = design.columns.filter(c => ["pilot", "site"].includes(c.id));
  design.columns[0].width = 25;
  const result = layoutRow(design, 420);
  expect(result.columns[0].pixels).toBe(100);
  expect(result.columns[1].pixels).toBe(292);
  expect(result.overflow).toBe(0);
});
it("reports over-allocation and supports individual child thresholds", () => {
  const design = defaultRowDesign("feed");
  design.columns[1].elements[1].drop = 500;
  const result = layoutRow(design, 320);
  expect(result.overflow).toBeGreaterThan(0);
  expect(result.columns.find(c => c.id === "pilot")!.elements.map(e => e.id)).toEqual(["name"]);
});
it("round-trips recipes and rejects invalid or duplicate settings", () => {
  const design = defaultRowDesign("logbook");
  design.columns.find(c => c.id === "date")!.flow = "date-two-line";
  expect(parseRowDesign(JSON.stringify(design))).toEqual(design);
  design.columns[0].drop = -1;
  expect(() => parseRowDesign(JSON.stringify(design))).toThrow();
  expect(() => parseRowDesign('{"version":2}')).toThrow();
});
