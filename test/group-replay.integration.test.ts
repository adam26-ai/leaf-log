// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { groupReplayFixtures } from "./igc/group-fixtures";
import type { GeoPoint } from "@/lib/flights/route-proximity";
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

async function timedFlight(ownerId: string, label: string, start: string, end: string, matchingPaths?: GeoPoint[][]) {
  const id = (await ingest({ ownerId, bytes: Buffer.concat([bytes[0], Buffer.from(`\nLTEST ${label}\n`)]) })).flightId;
  const flight = await prisma.flight.update({ where: { id }, data: { takeoffAt: new Date(start), landingAt: new Date(end), localUtcOffsetMinutes: -420 } });
  if (matchingPaths) {
    const artifact = await replayRepo.replayArtifactForFlight(flight);
    await prisma.flightData.update({ where: { flightId: id }, data: { replay: { ...artifact!, matchingPaths } as unknown as Prisma.InputJsonValue } });
  }
  return id;
}

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
    const companions = await repo.listReplayCompanions(ownFlight, self);
    expect(ids(companions)).toContain(aliceFlight);
    const alice = await prisma.flight.findUniqueOrThrow({ where: { id: aliceFlight } });
    const statistics = companions?.flights.find((flight) => flight.id === aliceFlight)?.statistics;
    expect(statistics).toMatchObject({ id: aliceFlight, durationS: alice.durationS, maxAltM: alice.maxAltM,
      altGainM: alice.altGainM, maxClimbMs: alice.maxClimbMs, maxSinkMs: alice.maxSinkMs, glider: alice.glider });
    expect(statistics).not.toHaveProperty("notes");
    expect(statistics).not.toHaveProperty("instructorId");
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
  it("requires actual overlap by default and finds separate morning/evening flights in day mode even with one own flight", async () => {
    const primary = await prisma.flight.findUniqueOrThrow({ where: { id: ownFlight } });
    const original = await prisma.flight.findUniqueOrThrow({ where: { id: aliceFlight } });
    const start = primary.takeoffAt!.getTime(), end = primary.landingAt!.getTime();
    try {
      for (const [takeoff, landing, overlaps] of [
        [start - 60_000, start - 1, false],
        [start - 60_000, start, false],
        [start - 60_000, start + 1, true],
        [end - 1, end + 60_000, true],
        [end, end + 60_000, false],
        [end + 1, end + 60_000, false],
        [start - 6 * 3_600_000, start - 5 * 3_600_000, false],
        [end + 5 * 3_600_000, end + 6 * 3_600_000, false],
      ] as const) {
        await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: new Date(takeoff), landingAt: new Date(landing) } });
        expect(ids(await repo.listReplayCompanions(ownFlight, self)).includes(aliceFlight)).toBe(overlaps);
        const expanded = await repo.listReplayCompanions(ownFlight, self, 0, true);
        expect(expanded?.dayExpanded).toBe(true);
        expect(ids(expanded)).toContain(aliceFlight);
      }
    } finally { await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: original.takeoffAt, landingAt: original.landingAt } }); }
  }, 30_000);
  it("expands to the full local calendar day and preserves complete flights across midnight", async () => {
    const owner = await pilot("dayowner"), friend = await pilot("dayfriend"), stranger = await pilot("daystranger");
    await prisma.friendship.create({ data: { requesterId: owner, addresseeId: friend, status: "accepted" } });
    const add = timedFlight;
    const primary = await add(owner, "primary", "2026-06-11T19:00:00Z", "2026-06-11T20:00:00Z");
    const early = await add(owner, "early", "2026-06-11T17:00:00Z", "2026-06-11T18:00:00Z");
    const late = await add(owner, "late", "2026-06-11T21:00:00Z", "2026-06-11T22:00:00Z");
    const previousDay = await add(owner, "previous", "2026-06-11T06:59:59Z", "2026-06-11T07:30:00Z");
    const nextDay = await add(owner, "next", "2026-06-12T07:00:00Z", "2026-06-12T08:00:00Z");
    const between = await add(friend, "between", "2026-06-11T12:00:00Z", "2026-06-11T13:00:00Z");
    const before = await add(friend, "before", "2026-06-11T07:00:00Z", "2026-06-11T08:00:00Z");
    const after = await add(friend, "after", "2026-06-12T06:59:59Z", "2026-06-12T08:00:00Z");
    const outsideBefore = await add(friend, "outside-before", "2026-06-11T06:59:59Z", "2026-06-11T08:00:00Z");
    const outsideAfter = await add(friend, "outside-after", "2026-06-12T07:00:00Z", "2026-06-12T08:00:00Z");
    const ordinary = await repo.listReplayCompanions(primary, owner);
    expect(ordinary).toMatchObject({ flights: [], dayExpanded: false });
    const expanded = await repo.listReplayCompanions(primary, owner, 0, true);
    expect(expanded).toMatchObject({ dayExpanded: true });
    expect(ids(expanded)).toEqual(expect.arrayContaining([early, late, between, before, after]));
    expect(expanded?.flights.find((f) => f.id === after)?.landingMs).toBe(new Date("2026-06-12T08:00:00Z").getTime());
    for (const id of [primary, previousDay, nextDay, outsideBefore, outsideAfter]) expect(ids(expanded)).not.toContain(id);
    await prisma.flight.update({ where: { id: between }, data: { visibility: "private", instructorId: owner } });
    expect(ids(await repo.listReplayCompanions(primary, owner, 0, true))).not.toContain(between);
    await prisma.flight.update({ where: { id: primary }, data: { visibility: "public" } });
    const unrelated = await repo.listReplayCompanions(primary, stranger, 0, true);
    expect(unrelated).toMatchObject({ dayExpanded: false });
    expect(unrelated?.flights.some((f) => f.owner.id === owner)).toBe(false);
  }, 60_000);
  it("keeps the 5 km search anchored to the opened route for both own and friend flights", async () => {
    const owner = await pilot("localowner"), friend = await pilot("localfriend");
    await prisma.friendship.create({ data: { requesterId: owner, addresseeId: friend, status: "accepted" } });
    const add = (pilotId: string, label: string, paths: GeoPoint[][]) => timedFlight(pilotId, label, "2026-06-11T19:00:00Z", "2026-06-11T20:00:00Z", paths);
    const primary = await add(owner, "origin", [[[0, 0], [0, 0.01]]]);
    const ownLong = await add(owner, "long-route", [[[0.036, 0], [0.15, 0]]]);
    const ownFar = await add(owner, "far-own", [[[10, 10], [10, 10.01]]]);
    const near = await add(friend, "near-friend", [[[0.044, 0], [0.044, 0.01]]]);
    const beyond = await add(friend, "beyond-limit", [[[0.046, 0], [0.046, 0.01]]]);
    const chained = await add(friend, "chained-friend", [[[0.15, 0], [0.15, 0.01]]]);
    expect(ids(await repo.listReplayCompanions(primary, owner))).toEqual([near]);
    const expanded = ids(await repo.listReplayCompanions(primary, owner, 0, true));
    expect(expanded).toEqual(expect.arrayContaining([ownLong, near]));
    for (const id of [ownFar, beyond, chained]) expect(expanded).not.toContain(id);
  }, 60_000);
  it("filters own flights by strict overlap, excluding later flights, private sharing, and removed friends", async () => {
    const matched = () => repo.logbookCompanions(self).then(friends => friends.find(friend => friend.key === alice)?.flightIds ?? []);
    expect(await matched()).toContain(ownFlight);
    const original = await prisma.flight.findUniqueOrThrow({ where: { id: aliceFlight } });
    const primary = await prisma.flight.findUniqueOrThrow({ where: { id: ownFlight } });
    try {
      await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: primary.landingAt, landingAt: new Date(primary.landingAt!.getTime() + 60_000) } });
      expect(await matched()).not.toContain(ownFlight);
      await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: new Date(primary.landingAt!.getTime() - 1) } });
      expect(await matched()).toContain(ownFlight);
      await prisma.flight.update({ where: { id: aliceFlight }, data: { visibility: "private" } });
      expect(await matched()).not.toContain(ownFlight);
    } finally { await prisma.flight.update({ where: { id: aliceFlight }, data: { takeoffAt: original.takeoffAt, landingAt: original.landingAt, visibility: original.visibility } }); }
    await prisma.friendship.update({ where: { requesterId_addresseeId: { requesterId: self, addresseeId: alice } }, data: { status: "pending" } });
    try { expect(await matched()).not.toContain(ownFlight); }
    finally { await prisma.friendship.update({ where: { requesterId_addresseeId: { requesterId: self, addresseeId: alice } }, data: { status: "accepted" } }); }
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
