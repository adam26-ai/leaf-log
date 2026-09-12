import { expect, it } from "vitest";
import { flightFlags, flightFlagsSchema } from "./type-flags";
import { emptyEntry, parseEntry } from "@/lib/logbook/entry";

it("combines all flight flags and recognizes legacy tandem and tow entries", () => {
  expect(flightFlags({ occupancy: "tandem", launchTypes: ["ST"], flightFlags: ["competition", "siv"] })).toEqual(["tandem", "siv", "competition", "tow"]);
  expect(flightFlagsSchema.safeParse(["other"] ).success).toBe(false);
});

it("saves simultaneous flags from manual or CSV input and preserves legacy tandem", () => {
  const parsed = parseEntry({ ...emptyEntry(), date: "2026-09-12", occupancy: "tandem", flightTypes: "siv;competition;tow" });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.data).toMatchObject({ occupancy: "tandem", flightFlags: ["siv", "competition", "tow", "tandem"], launchTypes: ["ST"] });
  expect(parseEntry({ ...emptyEntry(), date: "2026-09-12", flightTypes: "invalid" }).ok).toBe(false);
});
