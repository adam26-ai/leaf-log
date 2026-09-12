// @vitest-environment node
//
// lib/ratings/signoffs.ts end to end — write scoping (only the flight's
// CURRENT instructor may sign), read scoping (pilot always, original signer
// always, current instructor for continuity, nobody else), and the
// append-only "any active signoff = met" existence rule. Requires a local
// Postgres and must not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("rating signoffs (DB-backed)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let signoffs: typeof import("@/lib/ratings/signoffs");

  const ids: string[] = [];
  let pilotId = "";
  let alexId = ""; // original instructor/signer
  let samId = ""; // reassigned-to instructor
  let jordanId = ""; // never assigned, never signed
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
      throw new Error("DATABASE_URL is required for rating-signoffs integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    signoffs = await import("@/lib/ratings/signoffs");

    pilotId = await createPilot("Pilot");
    alexId = await createPilot("Alex");
    samId = await createPilot("Sam");
    jordanId = await createPilot("Jordan");

    const flight = await prisma.flight.create({
      data: {
        ownerId: pilotId,
        visibility: "private",
        status: "ready",
        igcSha256: `signoff_${suffix}`,
        instructorId: alexId,
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.ratingSignoff.deleteMany({ where: { flightId } });
    await prisma.flight.deleteMany({ where: { id: flightId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("rejects a non-signable criterionKey", async () => {
    const res = await signoffs.createSignoff(alexId, flightId, "not_a_real_criterion", null);
    expect(res).toEqual({ ok: false, error: "Not a signable criterion." });
  });

  it("rejects an actor who is not the flight's current instructor", async () => {
    const res = await signoffs.createSignoff(samId, flightId, "p2_precision_landings", null);
    expect(res).toEqual({
      ok: false,
      error: "You can only sign off a flight you currently instruct.",
    });
  });

  it("lets the current instructor (Alex) witness a criterion", async () => {
    const res = await signoffs.createSignoff(
      alexId,
      flightId,
      "p2_precision_landings",
      "3 consecutive within 10ft",
    );
    expect(res.ok).toBe(true);
  });

  it("is readable by the pilot and by Alex, but not by an unrelated pilot (Jordan)", async () => {
    const forPilot = await signoffs.activeSignoffsFor(pilotId, pilotId);
    expect(forPilot.map((s) => s.criterionKey)).toEqual(["p2_precision_landings"]);
    expect(forPilot[0].signedByDisplayName).toBe("Alex");

    const forAlex = await signoffs.activeSignoffsFor(pilotId, alexId);
    expect(forAlex.map((s) => s.criterionKey)).toEqual(["p2_precision_landings"]);

    const forJordan = await signoffs.activeSignoffsFor(pilotId, jordanId);
    expect(forJordan).toEqual([]);
  });

  describe("after reassigning the flight from Alex to Sam", () => {
    beforeAll(async () => {
      await prisma.flight.update({ where: { id: flightId }, data: { instructorId: samId } });
    });

    it("Alex can no longer write a new signoff on this flight", async () => {
      const res = await signoffs.createSignoff(alexId, flightId, "p2_skills_signoff", null);
      expect(res).toEqual({
        ok: false,
        error: "You can only sign off a flight you currently instruct.",
      });
    });

    it("Alex (original signer) can still read the signoff he made", async () => {
      const forAlex = await signoffs.activeSignoffsFor(pilotId, alexId);
      expect(forAlex.map((s) => s.criterionKey)).toEqual(["p2_precision_landings"]);
    });

    it("Sam (now current instructor) CAN read Alex's prior signoff, for continuity", async () => {
      const forSam = await signoffs.activeSignoffsFor(pilotId, samId);
      expect(forSam.map((s) => s.criterionKey)).toEqual(["p2_precision_landings"]);
    });

    it("Jordan (never assigned, never signed) still reads nothing", async () => {
      const forJordan = await signoffs.activeSignoffsFor(pilotId, jordanId);
      expect(forJordan).toEqual([]);
    });

    it("Sam can witness a new, separate criterion", async () => {
      const res = await signoffs.createSignoff(samId, flightId, "p2_skills_signoff", null);
      expect(res.ok).toBe(true);

      const forPilot = await signoffs.activeSignoffsFor(pilotId, pilotId);
      expect(forPilot.map((s) => s.criterionKey).sort()).toEqual(
        ["p2_precision_landings", "p2_skills_signoff"].sort(),
      );
    });
  });
});
