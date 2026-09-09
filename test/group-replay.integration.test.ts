// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { groupReplayFixtures } from "./igc/group-fixtures";
config({ path: ".env.local" });

const prisma = new PrismaClient();
const suffix = `gr${Date.now()}`;
const users: string[] = [];
let self: string, alice: string, ben: string, pending: string;
let ownFlight: string, aliceFlight: string, benFlight: string;
let repo: typeof import("@/lib/flights/repo");
let ingest: typeof import("@/lib/ingest/ingest-flight").ingestFlight;
let replayRepo: typeof import("@/lib/flights/replay-repo");
const bytes = groupReplayFixtures();

async function pilot(name: string) {
  const user = await prisma.user.create({ data: { email: `${suffix}${name}@test.local`, profile: { create: { handle: `${suffix}${name}`, displayName: name, defaultVisibility: "friends" } } } });
  users.push(user.id);
  return user.id;
}
const ids = (result: Awaited<ReturnType<typeof repo.listReplayCompanions>>) => result?.flights.map((f) => f.id) ?? [];

describe("viewer-scoped companion discovery", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("Local Postgres required for group privacy tests");
    repo = await import("@/lib/flights/repo");
    ingest = (await import("@/lib/ingest/ingest-flight")).ingestFlight;
    replayRepo = await import("@/lib/flights/replay-repo");
    [self, alice, ben, pending] = await Promise.all([pilot("self"), pilot("alice"), pilot("ben"), pilot("pending")]);
    await prisma.friendship.createMany({ data: [
      { requesterId: self, addresseeId: alice, status: "accepted" },
      { requesterId: alice, addresseeId: ben, status: "accepted" },
      { requesterId: alice, addresseeId: pending, status: "pending" },
    ] });
    ownFlight = (await ingest({ ownerId: self, bytes: bytes[0] })).flightId;
    aliceFlight = (await ingest({ ownerId: alice, bytes: bytes[1] })).flightId;
    benFlight = (await ingest({ ownerId: ben, bytes: bytes[0] })).flightId;
  }, 30_000);
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("discovers the supplied pair, including the viewer's own flight from a friend's page", async () => {
    expect(ids(await repo.listReplayCompanions(ownFlight, self))).toContain(aliceFlight);
    expect(ids(await repo.listReplayCompanions(aliceFlight, self))).toContain(ownFlight);
  });
  it("does not inherit Alice's access to Ben's friends-only flight or expose metadata", async () => {
    const result = await repo.listReplayCompanions(aliceFlight, self);
    expect(ids(result)).not.toContain(benFlight);
    expect(JSON.stringify(result)).not.toContain(ben);
    expect(await repo.getFlightForViewer(benFlight, self)).toBeNull();
  });
  it("allows discovering Ben's public flight, then removes it when private even with instructor access", async () => {
    await prisma.flight.update({ where: { id: benFlight }, data: { visibility: "public" } });
    expect(ids(await repo.listReplayCompanions(aliceFlight, self))).toContain(benFlight);
    await prisma.flight.update({ where: { id: benFlight }, data: { visibility: "private", instructorId: self } });
    expect(await repo.getFlightForViewer(benFlight, self)).not.toBeNull();
    expect(ids(await repo.listReplayCompanions(aliceFlight, self))).not.toContain(benFlight);
    await prisma.flight.update({ where: { id: benFlight }, data: { visibility: "friends", instructorId: null } });
  });
  it("reflects accepted and removed direct friendships on each request", async () => {
    await prisma.friendship.create({ data: { requesterId: ben, addresseeId: self, status: "accepted" } });
    expect(ids(await repo.listReplayCompanions(aliceFlight, self))).toContain(benFlight);
    await prisma.friendship.delete({ where: { requesterId_addresseeId: { requesterId: ben, addresseeId: self } } });
    expect(ids(await repo.listReplayCompanions(aliceFlight, self))).not.toContain(benFlight);
  });
  it("does not discover pending friends even when their flight is public", async () => {
    const flight = (await ingest({ ownerId: pending, bytes: bytes[1] })).flightId;
    await prisma.flight.update({ where: { id: flight }, data: { visibility: "public" } });
    expect(ids(await repo.listReplayCompanions(aliceFlight, self))).not.toContain(flight);
  });
  it("finds a later upload without modifying the primary flight", async () => {
    const late = await pilot("late");
    await prisma.friendship.create({ data: { requesterId: self, addresseeId: late, status: "accepted" } });
    expect((await repo.listReplayCompanions(ownFlight, self))!.flights.some((f) => f.owner.id === late)).toBe(false);
    const flight = (await ingest({ ownerId: late, bytes: bytes[1] })).flightId;
    expect(ids(await repo.listReplayCompanions(ownFlight, self))).toContain(flight);
    await prisma.flight.update({ where: { id: flight }, data: { visibility: "private" } });
  });
  it("includes exactly a one-hour interval gap and excludes a larger one", async () => {
    const primary = await prisma.flight.findUniqueOrThrow({ where: { id: ownFlight } });
    const original = await prisma.flight.findUniqueOrThrow({ where: { id: aliceFlight } });
    const start = primary.landingAt!.getTime() + 3_600_000;
    try {
      await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: new Date(start), landingAt: new Date(start + 60_000) } });
      expect(ids(await repo.listReplayCompanions(ownFlight, self))).toContain(aliceFlight);
      await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: new Date(start + 1) } });
      expect(ids(await repo.listReplayCompanions(ownFlight, self))).not.toContain(aliceFlight);
    } finally { await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: original.takeoffAt, landingAt: original.landingAt } }); }
  });
  it("lazily rebuilds a legacy artifact without changing access", async () => {
    await prisma.flightData.update({ where: { flightId: benFlight }, data: { replay: Prisma.JsonNull } });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: benFlight } });
    const [a, b] = await Promise.all([replayRepo.replayArtifactForFlight(flight), replayRepo.replayArtifactForFlight(flight)]);
    expect(a).toEqual(b);
    expect(a?.replay.samples.length).toBeGreaterThan(100);
    expect(await repo.getFlightForViewer(benFlight, self)).toBeNull();
  });
  it("requires primary access and keeps signed-out public replay solo", async () => {
    expect(await repo.listReplayCompanions(ownFlight, null)).toBeNull();
    await prisma.flight.update({ where: { id: ownFlight }, data: { visibility: "public" } });
    expect(await repo.listReplayCompanions(ownFlight, null)).toEqual({ flights: [], nextCursor: null });
    await prisma.flight.update({ where: { id: ownFlight }, data: { visibility: "friends" } });
  });
});
