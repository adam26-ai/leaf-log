// @vitest-environment node
//
// lib/ratings/notes.ts end to end, through the exact reassignment scenario
// anchoring decision 2 (SPRINT-009.md) exists to prevent: a note written by
// a PRIOR instructor must stay readable by its author and the flight's
// owner, never gain a new instructor read access, and freeze against
// further edits by anyone. Requires a local Postgres and must not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("instructor notes (DB-backed)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let notes: typeof import("@/lib/ratings/notes");

  const ids: string[] = [];
  let ownerId = "";
  let alexId = "";
  let samId = "";
  let publicViewerId = "";
  let flightId = "";

  async function createPilot(label: string) {
    const handle = `${label}${ids.length}${suffix}`.slice(0, 20).toLowerCase();
    const user = await prisma.user.create({
      data: {
        email: `${handle}@test.local`,
        profile: { create: { handle, displayName: label } },
      },
    });
    ids.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for instructor-notes integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    notes = await import("@/lib/ratings/notes");

    ownerId = await createPilot("Owner");
    alexId = await createPilot("Alex");
    samId = await createPilot("Sam");
    publicViewerId = await createPilot("PublicViewer");

    const flight = await prisma.flight.create({
      data: {
        ownerId,
        visibility: "public",
        status: "ready",
        igcSha256: `instr_note_${suffix}`,
        instructorId: alexId,
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.instructorNote.deleteMany({ where: { flightId } });
    await prisma.flight.deleteMany({ where: { id: flightId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("lets the current instructor (Alex) write a note", async () => {
    const res = await notes.upsertInstructorNote(alexId, flightId, "Good symmetric brakes.");
    expect(res.ok).toBe(true);
  });

  it("is readable by the owner and by Alex, but not by an unrelated (public) viewer", async () => {
    const forOwner = await notes.listInstructorNotesForViewer(flightId, ownerId);
    expect(forOwner.map((n) => n.body)).toEqual(["Good symmetric brakes."]);

    const forAlex = await notes.listInstructorNotesForViewer(flightId, alexId);
    expect(forAlex.map((n) => n.body)).toEqual(["Good symmetric brakes."]);

    const forPublic = await notes.listInstructorNotesForViewer(flightId, publicViewerId);
    expect(forPublic).toEqual([]);
  });

  it("Sam cannot read Alex's note before ever being assigned", async () => {
    const forSam = await notes.listInstructorNotesForViewer(flightId, samId);
    expect(forSam).toEqual([]);
  });

  describe("after reassigning the flight from Alex to Sam", () => {
    beforeAll(async () => {
      await prisma.flight.update({ where: { id: flightId }, data: { instructorId: samId } });
    });

    it("freezes Alex's note against further edits", async () => {
      const res = await notes.upsertInstructorNote(alexId, flightId, "trying to edit after reassignment");
      expect(res).toEqual({
        ok: false,
        error: "You can only leave a note on a flight you currently instruct.",
      });
    });

    it("Alex can still read his own note", async () => {
      const forAlex = await notes.listInstructorNotesForViewer(flightId, alexId);
      expect(forAlex.map((n) => n.body)).toEqual(["Good symmetric brakes."]);
      expect(forAlex[0].isCurrentInstructor).toBe(false);
    });

    it("Sam does NOT gain access to Alex's note just by becoming the current instructor", async () => {
      const forSam = await notes.listInstructorNotesForViewer(flightId, samId);
      expect(forSam).toEqual([]);
    });

    it("Sam can write his own, separate note", async () => {
      const res = await notes.upsertInstructorNote(samId, flightId, "Nice flare timing today.");
      expect(res.ok).toBe(true);

      const forSam = await notes.listInstructorNotesForViewer(flightId, samId);
      expect(forSam.map((n) => n.body)).toEqual(["Nice flare timing today."]);
      expect(forSam[0].isCurrentInstructor).toBe(true);
    });

    it("the owner reads both notes; the public viewer still reads neither", async () => {
      const forOwner = await notes.listInstructorNotesForViewer(flightId, ownerId);
      expect(forOwner.map((n) => n.body).sort()).toEqual(
        ["Good symmetric brakes.", "Nice flare timing today."].sort(),
      );

      const forPublic = await notes.listInstructorNotesForViewer(flightId, publicViewerId);
      expect(forPublic).toEqual([]);
    });
  });
});
