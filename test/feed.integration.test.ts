// @vitest-environment node
//
// Friends feed invariants. Requires a local Postgres and must not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { navigationCounts } from "@/lib/social/notifications";
import { listHighlights } from "@/lib/flights/list-highlights";
config({ path: ".env.local" });

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("friends feed", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/flights/repo");
  const ids: string[] = [];
  let flightSeq = 0;

  async function createPilot(label: string) {
    const handle = `${label}${ids.length}${suffix}`.slice(0, 24).toLowerCase();
    const user = await prisma.user.create({
      data: {
        email: `${handle}@test.local`,
        profile: { create: { handle, displayName: label } },
      },
    });
    ids.push(user.id);
    return { id: user.id, handle };
  }

  async function createFlight({
    ownerId,
    visibility,
    status = "ready",
    label,
    flightDate = new Date("2026-06-01T00:00:00.000Z"),
    takeoffAt = new Date("2026-06-01T10:00:00.000Z"),
  }: {
    ownerId: string;
    visibility: "private" | "friends" | "public";
    status?: string;
    label: string;
    flightDate?: Date | null;
    takeoffAt?: Date | null;
  }) {
    flightSeq += 1;
    // No takeoffSiteId/SiteName here on purpose: fabricating a cached name
    // with no linked site id would simulate the "historical fallback" state
    // (a genuinely deleted site) without ever having a real site behind it —
    // a hole in the SPRINT-004 invariant that a non-null cached name implies
    // either a live site or a real prior one. This test exercises feed
    // visibility, not site names, so "no site" is the honest fixture.
    return prisma.flight.create({
      data: {
        ownerId,
        visibility,
        status,
        igcSha256: `${label}${suffix}${flightSeq}`,
        flightDate,
        takeoffAt,
        durationS: 60 + flightSeq,
      },
    });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for feed integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/flights/repo");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.kudo.deleteMany({ where: { profileId: { in: ids } } });
    await prisma.friendship.deleteMany({
      where: {
        OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("counts only new visible friend flights and incoming requests, and persists a monotonic read time", async () => {
    const viewer = await createPilot("badge");
    const friend = await createPilot("badgefriend");
    const incoming = await createPilot("incoming");
    const outgoing = await createPilot("outgoing");
    await prisma.friendship.createMany({ data: [
      { requesterId: viewer.id, addresseeId: friend.id, status: "accepted" },
      { requesterId: incoming.id, addresseeId: viewer.id, status: "pending" },
      { requesterId: viewer.id, addresseeId: outgoing.id, status: "pending" },
    ] });
    const visible = await createFlight({ ownerId: friend.id, visibility: "friends", label: "new" });
    await createFlight({ ownerId: friend.id, visibility: "private", label: "private" });
    await createFlight({ ownerId: friend.id, visibility: "public", status: "processing", label: "processing" });
    await createFlight({ ownerId: incoming.id, visibility: "public", label: "stranger" });
    await createFlight({ ownerId: viewer.id, visibility: "public", label: "own" });
    // Explicit times avoid millisecond ties with account creation.
    const baseline = new Date("2026-01-01T00:00:00Z");
    await prisma.profile.update({ where: { id: viewer.id }, data: { createdAt: baseline } });
    expect(await navigationCounts(viewer.id)).toEqual({ feed: 1, friends: 1 });
    const viewedAt = new Date(visible.createdAt.getTime() + 1);
    expect(await navigationCounts(viewer.id, viewedAt)).toEqual({ feed: 0, friends: 1 });
    expect(await navigationCounts(viewer.id, baseline)).toEqual({ feed: 0, friends: 1 });
    const later = await createFlight({ ownerId: friend.id, visibility: "public", label: "later" });
    await prisma.flight.update({ where: { id: later.id }, data: { createdAt: new Date(viewedAt.getTime() + 1) } });
    expect(await navigationCounts(viewer.id)).toEqual({ feed: 1, friends: 1 });
    await prisma.friendship.deleteMany({ where: { addresseeId: viewer.id, status: "pending" } });
    await prisma.friendship.deleteMany({ where: { requesterId: viewer.id, addresseeId: friend.id } });
    expect(await navigationCounts(viewer.id)).toEqual({ feed: 0, friends: 0 });
  });

  it("matches each pilot's full logbook shading independently of feed pagination and other pilots", async () => {
    const viewer = await createPilot("shadeViewer");
    const pilotA = await createPilot("shadeA");
    const pilotB = await createPilot("shadeB");
    await prisma.friendship.createMany({ data: [
      { requesterId: viewer.id, addresseeId: pilotA.id, status: "accepted" },
      { requesterId: viewer.id, addresseeId: pilotB.id, status: "accepted" },
    ] });
    const visible = await createFlight({ ownerId: pilotA.id, visibility: "friends", label: "shade-visible", flightDate: new Date("2026-06-09") });
    const hidden = await createFlight({ ownerId: pilotA.id, visibility: "private", label: "shade-record" });
    const older = await createFlight({ ownerId: pilotA.id, visibility: "public", label: "shade-older", flightDate: new Date("2020-01-01") });
    const failed = await createFlight({ ownerId: pilotA.id, visibility: "private", status: "failed", label: "shade-failed" });
    const other = await createFlight({ ownerId: pilotB.id, visibility: "public", label: "shade-other", flightDate: new Date("2026-06-10") });
    await Promise.all([
      { flight: visible, duration: 100, distance: 1000 },
      { flight: hidden, duration: 400, distance: 4000 },
      { flight: older, duration: 200, distance: 2000 },
      { flight: failed, duration: 10000, distance: 100000 },
      { flight: other, duration: 100, distance: 1000 },
    ].map(async ({ flight, duration, distance }) => {
      await prisma.flight.update({ where: { id: flight.id }, data: {
        durationS: duration, maxAltM: 500 + duration, launchAltM: 500,
        recordingKind: "logbook", reportedXcType: "open", reportedXcDistanceM: distance,
      } });
    }));
    const page1 = await repo.listFeedForViewer(viewer.id, { limit: 1 });
    const page2 = await repo.listFeedForViewer(viewer.id, { limit: 1, cursor: page1.nextCursor });
    expect(page1.rows.map(flight => flight.id)).toEqual([other.id]);
    expect(page2.rows.map(flight => flight.id)).toEqual([visible.id]);
    const scores = await repo.highlightsForVisibleFlights([...page1.rows, ...page2.rows]);
    expect(scores).toEqual({
      [other.id]: { highlightScore: 1, distanceScore: 1 },
      [visible.id]: { highlightScore: 0.25, distanceScore: 0.25 },
    });
    expect(await repo.highlightsForVisibleFlights(page2.rows)).toEqual({ [visible.id]: scores[visible.id] });
    const ownFlights = await repo.listOwnFlights(pilotA.id);
    const ownFlight = ownFlights.find(flight => flight.id === visible.id)!;
    const ownHighlights = listHighlights(ownFlights);
    expect(scores[visible.id]).toEqual({ highlightScore: ownHighlights.highlightScore(ownFlight), distanceScore: ownHighlights.distanceScore(ownFlight) });
    expect(scores).not.toHaveProperty(hidden.id);
    expect(scores).not.toHaveProperty(older.id);
    expect(scores).not.toHaveProperty(failed.id);
    expect(await repo.highlightsForVisibleFlights([])).toEqual({});
  });

  it("ranks trophies per pilot across full history while returning only authorized flight awards", async () => {
    const pilotA = await createPilot("trophyA");
    const pilotB = await createPilot("trophyB");
    const visible = await createFlight({ ownerId: pilotA.id, visibility: "public", label: "silver" });
    const hidden = await createFlight({ ownerId: pilotA.id, visibility: "private", label: "gold" });
    const other = await createFlight({ ownerId: pilotB.id, visibility: "public", label: "other-gold" });
    await prisma.flight.updateMany({ where: { id: { in: [visible.id, hidden.id, other.id] } }, data: { recordingKind: "logbook" } });
    const result = await repo.trophiesForVisibleFlights([visible, other]);
    expect(result[visible.id]).toEqual(expect.arrayContaining([expect.objectContaining({ category: "duration", rank: 2 })]));
    expect(result[other.id]).toEqual(expect.arrayContaining([expect.objectContaining({ category: "duration", rank: 1 })]));
    expect(result).not.toHaveProperty(hidden.id);
    expect(await repo.trophiesForVisibleFlights([visible])).toEqual({ [visible.id]: result[visible.id] });
  });

  it("shows a friend's public and friends-only ready flights and excludes hidden rows", async () => {
    const viewer = await createPilot("feedViewer");
    const friend = await createPilot("feedFriend");
    const nonFriend = await createPilot("feedNonFriend");
    const pending = await createPilot("feedPending");

    await prisma.friendship.createMany({
      data: [
        { requesterId: viewer.id, addresseeId: friend.id, status: "accepted" },
        { requesterId: pending.id, addresseeId: viewer.id, status: "pending" },
      ],
    });

    const friendPublic = await createFlight({
      ownerId: friend.id,
      visibility: "public",
      label: "friend-public",
      flightDate: new Date("2026-06-05T00:00:00.000Z"),
    });
    const friendFriends = await createFlight({
      ownerId: friend.id,
      visibility: "friends",
      label: "friend-friends",
      flightDate: new Date("2026-06-04T00:00:00.000Z"),
    });
    await createFlight({
      ownerId: friend.id,
      visibility: "private",
      label: "friend-private",
      flightDate: new Date("2026-06-03T00:00:00.000Z"),
    });
    await createFlight({
      ownerId: friend.id,
      visibility: "public",
      status: "uploaded",
      label: "friend-uploaded",
      flightDate: new Date("2026-06-02T00:00:00.000Z"),
    });
    await createFlight({
      ownerId: viewer.id,
      visibility: "public",
      label: "viewer-own",
      flightDate: new Date("2026-06-06T00:00:00.000Z"),
    });
    await createFlight({
      ownerId: nonFriend.id,
      visibility: "public",
      label: "non-friend-public",
      flightDate: new Date("2026-06-07T00:00:00.000Z"),
    });
    await createFlight({
      ownerId: pending.id,
      visibility: "public",
      label: "pending-public",
      flightDate: new Date("2026-06-08T00:00:00.000Z"),
    });
    await prisma.kudo.create({
      data: { flightId: friendFriends.id, profileId: viewer.id },
    });

    const feed = await repo.listFeedForViewer(viewer.id, { limit: 20 });

    expect(feed.rows.map((flight) => flight.id)).toEqual([
      friendPublic.id,
      friendFriends.id,
    ]);
    expect(feed.rows.map((flight) => flight.owner.handle)).toEqual([
      friend.handle,
      friend.handle,
    ]);
    expect(feed.rows.find((flight) => flight.id === friendFriends.id)?.kudoCount).toBe(
      1,
    );
    expect(feed.nextCursor).toBeNull();
  });

  it("paginates stably without overlaps when flights share the same date and time", async () => {
    const viewer = await createPilot("pageViewer");
    const friend = await createPilot("pageFriend");
    await prisma.friendship.create({
      data: { requesterId: viewer.id, addresseeId: friend.id, status: "accepted" },
    });

    const sameFlightDate = new Date("2026-06-10T00:00:00.000Z");
    const sameTakeoffAt = new Date("2026-06-10T12:00:00.000Z");
    const flights = await Promise.all(
      [0, 1, 2, 3].map((n) =>
        createFlight({
          ownerId: friend.id,
          visibility: n % 2 === 0 ? "public" : "friends",
          label: `page-${n}`,
          flightDate: sameFlightDate,
          takeoffAt: sameTakeoffAt,
        }),
      ),
    );

    const page1 = await repo.listFeedForViewer(viewer.id, { limit: 2 });
    const page2 = await repo.listFeedForViewer(viewer.id, {
      limit: 2,
      cursor: page1.nextCursor,
    });

    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const seen = [...page1.rows, ...page2.rows].map((flight) => flight.id);
    expect(new Set(seen).size).toBe(4);
    expect(seen.sort()).toEqual(flights.map((flight) => flight.id).sort());
  });

  it("does not crash or duplicate if friendship changes between pages", async () => {
    const viewer = await createPilot("changeViewer");
    const friend = await createPilot("changeFriend");
    await prisma.friendship.create({
      data: { requesterId: viewer.id, addresseeId: friend.id, status: "accepted" },
    });

    await Promise.all(
      [0, 1, 2].map((n) =>
        createFlight({
          ownerId: friend.id,
          visibility: "public",
          label: `change-${n}`,
          flightDate: new Date(`2026-06-${20 + n}T00:00:00.000Z`),
        }),
      ),
    );

    const page1 = await repo.listFeedForViewer(viewer.id, { limit: 2 });
    await prisma.friendship.deleteMany({
      where: {
        status: "accepted",
        OR: [
          { requesterId: viewer.id, addresseeId: friend.id },
          { requesterId: friend.id, addresseeId: viewer.id },
        ],
      },
    });
    const page2 = await repo.listFeedForViewer(viewer.id, {
      limit: 2,
      cursor: page1.nextCursor,
    });

    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toEqual([]);
    expect(page2.nextCursor).toBeNull();
  });
});
