import { describe, expect, it } from "vitest";
import { canReadInstructorNote, canWriteInstructorNote } from "./authz";

// canAssignInstructor is DB-backed (re-reads the live friend graph) and is
// covered by test/instructor-authz.integration.test.ts instead.

describe("canWriteInstructorNote", () => {
  it("allows the author while they are still the flight's current instructor", () => {
    expect(canWriteInstructorNote("alex", "alex", "alex")).toBe(true);
  });

  it("rejects the author once reassigned away — the exact anchoring-decision-2 scenario", () => {
    // Alex authored the note; the flight is now instructed by Sam.
    expect(canWriteInstructorNote("alex", "alex", "sam")).toBe(false);
  });

  it("rejects the new instructor editing a note they didn't author", () => {
    // Sam is now the current instructor, but "alex" authored this note.
    expect(canWriteInstructorNote("sam", "alex", "sam")).toBe(false);
  });

  it("rejects when there is no current instructor at all", () => {
    expect(canWriteInstructorNote("alex", "alex", null)).toBe(false);
  });
});

describe("canReadInstructorNote", () => {
  it("always allows the flight's owner", () => {
    expect(canReadInstructorNote("owner", "owner", "alex")).toBe(true);
  });

  it("always allows the note's own author, even after reassignment", () => {
    expect(canReadInstructorNote("alex", "owner", "alex")).toBe(true);
  });

  it("rejects a different (even currently-assigned) instructor", () => {
    // Sam is not this note's author and is not the owner.
    expect(canReadInstructorNote("sam", "owner", "alex")).toBe(false);
  });

  it("rejects any other viewer, independent of the flight's own visibility", () => {
    expect(canReadInstructorNote("some_friend_or_public_viewer", "owner", "alex")).toBe(false);
  });
});
