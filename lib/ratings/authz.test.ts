import { describe, expect, it } from "vitest";
import {
  canReadInstructorNote,
  canReadSignoff,
  canWriteInstructorNote,
  canWriteSignoff,
} from "./authz";

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

describe("canWriteSignoff", () => {
  it("allows the flight's current instructor", () => {
    expect(canWriteSignoff("alex", "alex")).toBe(true);
  });

  it("rejects anyone who isn't the current instructor, including a former one", () => {
    expect(canWriteSignoff("alex", "sam")).toBe(false);
  });

  it("rejects when there is no current instructor at all", () => {
    expect(canWriteSignoff("alex", null)).toBe(false);
  });
});

describe("canReadSignoff", () => {
  it("always allows the pilot the signoff is about", () => {
    expect(canReadSignoff("pilot", "pilot", "alex", "sam")).toBe(true);
  });

  it("always allows the original signer, even after reassignment", () => {
    expect(canReadSignoff("alex", "pilot", "alex", "sam")).toBe(true);
  });

  it("allows whoever is CURRENTLY the flight's instructor, for continuity", () => {
    expect(canReadSignoff("sam", "pilot", "alex", "sam")).toBe(true);
  });

  it("rejects a former instructor who neither signed it nor is the pilot", () => {
    // "jordan" was instructor before Alex signed, is not the pilot, and is
    // not currently assigned (sam is).
    expect(canReadSignoff("jordan", "pilot", "alex", "sam")).toBe(false);
  });

  it("rejects any friend/public viewer, independent of the flight's own visibility", () => {
    expect(canReadSignoff("some_friend_or_public_viewer", "pilot", "alex", "sam")).toBe(false);
  });
});
