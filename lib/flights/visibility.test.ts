import { describe, expect, it } from "vitest";
import {
  FLIGHT_VISIBILITIES,
  canSee,
  normalizeVisibility,
  type FlightVisibility,
} from "./visibility";

describe("flight visibility", () => {
  it("normalizes allowed values and fails closed for anything else", () => {
    for (const visibility of FLIGHT_VISIBILITIES) {
      expect(normalizeVisibility(visibility)).toBe(visibility);
    }

    expect(normalizeVisibility("")).toBe("private");
    expect(normalizeVisibility("friend")).toBe("private");
    expect(normalizeVisibility("PUBLIC")).toBe("private");
    expect(normalizeVisibility(null)).toBe("private");
    expect(normalizeVisibility(undefined)).toBe("private");
    expect(normalizeVisibility({ visibility: "public" })).toBe("private");
  });

  it("applies the read truth table", () => {
    const cases: Array<{
      visibility: FlightVisibility;
      isOwner: boolean;
      isFriend: boolean;
      expected: boolean;
    }> = [
      { visibility: "private", isOwner: true, isFriend: false, expected: true },
      { visibility: "private", isOwner: true, isFriend: true, expected: true },
      { visibility: "private", isOwner: false, isFriend: false, expected: false },
      { visibility: "private", isOwner: false, isFriend: true, expected: false },
      { visibility: "friends", isOwner: true, isFriend: false, expected: true },
      { visibility: "friends", isOwner: true, isFriend: true, expected: true },
      { visibility: "friends", isOwner: false, isFriend: false, expected: false },
      { visibility: "friends", isOwner: false, isFriend: true, expected: true },
      { visibility: "public", isOwner: true, isFriend: false, expected: true },
      { visibility: "public", isOwner: true, isFriend: true, expected: true },
      { visibility: "public", isOwner: false, isFriend: false, expected: true },
      { visibility: "public", isOwner: false, isFriend: true, expected: true },
    ];

    for (const row of cases) {
      expect(canSee(row.visibility, row.isOwner, row.isFriend)).toBe(row.expected);
    }
  });
});
