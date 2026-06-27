// @vitest-environment node
//
// Friend graph and kudos invariants. Requires a local Postgres and must not skip.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const suffix = `${process.pid}${Math.floor(Math.random() * 1e5)}`;

describe("friend graph", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let friends: typeof import("@/lib/social/friends");
  let kudos: typeof import("@/lib/social/kudos");
  const ids: string[] = [];
  let flightSeq = 0;

  async function createPilot(label: string) {
    const handle = `${label}${ids.length}${suffix}`.slice(0, 20).toLowerCase();
    const user = await prisma.user.create({
      data: {
        email: `${handle}@test.local`,
        profile: { create: { handle, displayName: label } },
      },
    });
    ids.push(user.id);
    return { id: user.id, handle };
  }

  function pairWhere(aId: string, bId: string) {
    return {
      OR: [
        { requesterId: aId, addresseeId: bId },
        { requesterId: bId, addresseeId: aId },
      ],
    };
  }

  async function createReadyFlight(
    ownerId: string,
    visibility: "private" | "friends" | "public",
    label: string,
  ) {
    flightSeq += 1;
    return prisma.flight.create({
      data: {
        ownerId,
        visibility,
        status: "ready",
        igcSha256: `${label}${suffix}${flightSeq}`,
        flightDate: new Date("2026-06-01T00:00:00.000Z"),
        takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for social integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    friends = await import("@/lib/social/friends");
    kudos = await import("@/lib/social/kudos");
  });

  beforeEach(async () => {
    await prisma.kudo.deleteMany({
      where: { profileId: { in: ids } },
    });
    await prisma.friendship.deleteMany({
      where: {
        OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }],
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.kudo.deleteMany({
      where: { profileId: { in: ids } },
    });
    await prisma.friendship.deleteMany({
      where: {
        OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("sendRequest creates a pending outgoing request", async () => {
    const a = await createPilot("sendA");
    const b = await createPilot("sendB");

    await friends.sendRequest(a.id, b.id);

    const row = await prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: a.id, addresseeId: b.id } },
    });
    expect(row?.status).toBe("pending");
    expect(await friends.friendStateFor(a.id, b.id)).toBe("outgoing");
    expect(await friends.friendStateFor(b.id, a.id)).toBe("incoming");
    expect(await friends.countFriends(a.id)).toBe(0);
  });

  it("acceptRequest makes the pilots friends both directions", async () => {
    const a = await createPilot("accA");
    const b = await createPilot("accB");
    await friends.sendRequest(a.id, b.id);

    await friends.acceptRequest(b.id, a.id);

    expect(await friends.areFriends(a.id, b.id)).toBe(true);
    expect(await friends.areFriends(b.id, a.id)).toBe(true);
    expect(await friends.friendStateFor(a.id, b.id)).toBe("friends");
    expect(await friends.friendStateFor(b.id, a.id)).toBe("friends");
    expect(await friends.countFriends(a.id)).toBe(1);
    expect(await friends.countFriends(b.id)).toBe(1);
    const listed = await friends.listFriends(a.id);
    expect(listed.map((p) => p.id)).toEqual([b.id]);
  });

  it("declineRequest deletes a pending incoming request", async () => {
    const a = await createPilot("decA");
    const b = await createPilot("decB");
    await friends.sendRequest(a.id, b.id);

    await friends.declineRequest(b.id, a.id);

    expect(await prisma.friendship.count({ where: pairWhere(a.id, b.id) })).toBe(0);
    expect(await friends.friendStateFor(a.id, b.id)).toBe("none");
  });

  it("cancelRequest deletes a pending outgoing request", async () => {
    const a = await createPilot("canA");
    const b = await createPilot("canB");
    await friends.sendRequest(a.id, b.id);

    await friends.cancelRequest(a.id, b.id);

    expect(await prisma.friendship.count({ where: pairWhere(a.id, b.id) })).toBe(0);
    expect(await friends.friendStateFor(a.id, b.id)).toBe("none");
  });

  it("sendRequest auto-accepts a reverse pending request without a duplicate row", async () => {
    const a = await createPilot("revA");
    const b = await createPilot("revB");
    await friends.sendRequest(b.id, a.id);

    await friends.sendRequest(a.id, b.id);

    const rows = await prisma.friendship.findMany({ where: pairWhere(a.id, b.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("accepted");
    expect(rows[0].respondedAt).not.toBeNull();
  });

  it("sendRequest rejects self-requests", async () => {
    const a = await createPilot("selfA");

    await expect(friends.sendRequest(a.id, a.id)).rejects.toThrow(
      "You cannot friend yourself.",
    );
    expect(
      await prisma.friendship.count({
        where: { requesterId: a.id, addresseeId: a.id },
      }),
    ).toBe(0);
    expect(await friends.friendStateFor(a.id, a.id)).toBe("self");
  });

  it("removeFriend deletes an accepted friendship in either direction", async () => {
    const a = await createPilot("remA");
    const b = await createPilot("remB");
    await friends.sendRequest(a.id, b.id);
    await friends.acceptRequest(b.id, a.id);

    await friends.removeFriend(b.id, a.id);

    expect(await friends.areFriends(a.id, b.id)).toBe(false);
    expect(await friends.friendStateFor(a.id, b.id)).toBe("none");
    expect(await friends.countFriends(a.id)).toBe(0);
  });

  it("friendStateFor distinguishes none, outgoing, incoming, and friends", async () => {
    const a = await createPilot("stateA");
    const b = await createPilot("stateB");

    expect(await friends.friendStateFor(a.id, b.id)).toBe("none");
    await friends.sendRequest(a.id, b.id);
    expect(await friends.friendStateFor(a.id, b.id)).toBe("outgoing");
    expect(await friends.friendStateFor(b.id, a.id)).toBe("incoming");

    const incoming = await friends.listIncomingRequests(b.id);
    const outgoing = await friends.listOutgoingRequests(a.id);
    expect(incoming.map((r) => r.requesterId)).toEqual([a.id]);
    expect(outgoing.map((r) => r.addresseeId)).toEqual([b.id]);

    await friends.acceptRequest(b.id, a.id);
    expect(await friends.friendStateFor(a.id, b.id)).toBe("friends");
    expect(await friends.areFriends(a.id, b.id)).toBe(true);
  });

  it("deleting a Profile cascades friendship rows", async () => {
    const a = await createPilot("casA");
    const b = await createPilot("casB");
    await friends.sendRequest(a.id, b.id);
    await friends.acceptRequest(b.id, a.id);

    await prisma.profile.delete({ where: { id: b.id } });

    expect(
      await prisma.friendship.count({
        where: pairWhere(a.id, b.id),
      }),
    ).toBe(0);
  });

  it("toggleKudo on a visible flight toggles on, off, and on with count tracking", async () => {
    const owner = await createPilot("kudoOwner");
    const viewer = await createPilot("kudoViewer");
    const flight = await createReadyFlight(owner.id, "public", "toggle");

    await expect(kudos.toggleKudo(flight.id, viewer.id)).resolves.toEqual({
      kudoed: true,
    });
    expect((await kudos.kudoSummaryForViewer(flight.id, viewer.id)).count).toBe(1);

    await expect(kudos.toggleKudo(flight.id, viewer.id)).resolves.toEqual({
      kudoed: false,
    });
    expect((await kudos.kudoSummaryForViewer(flight.id, viewer.id)).count).toBe(0);

    await expect(kudos.toggleKudo(flight.id, viewer.id)).resolves.toEqual({
      kudoed: true,
    });
    const summary = await kudos.kudoSummaryForViewer(flight.id, viewer.id);
    expect(summary.count).toBe(1);
    expect(summary.hasKudoed).toBe(true);
  });

  it("cannot kudos a private or non-friend friends-only flight", async () => {
    const owner = await createPilot("hiddenOwner");
    const viewer = await createPilot("hiddenViewer");
    const privateFlight = await createReadyFlight(owner.id, "private", "hiddenPriv");
    const friendsFlight = await createReadyFlight(owner.id, "friends", "hiddenFriends");

    await expect(kudos.toggleKudo(privateFlight.id, viewer.id)).rejects.toThrow(
      "Flight not found.",
    );
    await expect(kudos.toggleKudo(friendsFlight.id, viewer.id)).rejects.toThrow(
      "Flight not found.",
    );
    await expect(kudos.toggleKudo("missing-flight-id", viewer.id)).rejects.toThrow(
      "Flight not found.",
    );
    expect(await prisma.kudo.count({ where: { profileId: viewer.id } })).toBe(0);
  });

  it("rejects self-kudos", async () => {
    const owner = await createPilot("selfKudo");
    const flight = await createReadyFlight(owner.id, "public", "selfKudo");

    await expect(kudos.toggleKudo(flight.id, owner.id)).rejects.toThrow(
      "You cannot kudos your own flight.",
    );
    expect(await prisma.kudo.count({ where: { flightId: flight.id } })).toBe(0);
  });

  it("kudoSummaryForViewer returns count, hasKudoed, and bounded recent profiles", async () => {
    const owner = await createPilot("sumOwner");
    const viewer = await createPilot("sumViewer");
    const flight = await createReadyFlight(owner.id, "public", "summary");
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();

    await prisma.kudo.create({
      data: {
        flightId: flight.id,
        profileId: viewer.id,
        createdAt: new Date(base),
      },
    });

    const kudoers = [];
    for (let i = 0; i < 14; i += 1) {
      const pilot = await createPilot(`recent${i}`);
      kudoers.push(pilot);
      await prisma.kudo.create({
        data: {
          flightId: flight.id,
          profileId: pilot.id,
          createdAt: new Date(base + (i + 1) * 1000),
        },
      });
    }

    const summary = await kudos.kudoSummaryForViewer(flight.id, viewer.id);
    expect(summary.count).toBe(15);
    expect(summary.hasKudoed).toBe(true);
    expect(summary.recent).toHaveLength(12);
    expect(summary.recent.map((profile) => profile.id)).toEqual(
      kudoers
        .slice(2)
        .reverse()
        .map((pilot) => pilot.id),
    );

    const stranger = await createPilot("sumStranger");
    const privateFlight = await createReadyFlight(owner.id, "private", "summaryPriv");
    await expect(
      kudos.kudoSummaryForViewer(privateFlight.id, stranger.id),
    ).rejects.toThrow("Flight not found.");
  });

  it("lets a friend kudos a friends-only flight", async () => {
    const owner = await createPilot("friendKudoOwner");
    const viewer = await createPilot("friendKudoViewer");
    const flight = await createReadyFlight(owner.id, "friends", "friendKudo");
    await friends.sendRequest(owner.id, viewer.id);
    await friends.acceptRequest(viewer.id, owner.id);

    await expect(kudos.toggleKudo(flight.id, viewer.id)).resolves.toEqual({
      kudoed: true,
    });
    expect((await kudos.kudoSummaryForViewer(flight.id, viewer.id)).count).toBe(1);
  });

  it("concurrent double toggles converge without duplicate-key crashes", async () => {
    const owner = await createPilot("raceOwner");
    const viewer = await createPilot("raceViewer");
    const flight = await createReadyFlight(owner.id, "public", "race");

    const firstPair = await Promise.allSettled([
      kudos.toggleKudo(flight.id, viewer.id),
      kudos.toggleKudo(flight.id, viewer.id),
    ]);
    expect(firstPair.every((result) => result.status === "fulfilled")).toBe(true);
    expect((await kudos.kudoSummaryForViewer(flight.id, viewer.id)).count).toBe(0);

    await kudos.toggleKudo(flight.id, viewer.id);
    const secondPair = await Promise.allSettled([
      kudos.toggleKudo(flight.id, viewer.id),
      kudos.toggleKudo(flight.id, viewer.id),
    ]);
    expect(secondPair.every((result) => result.status === "fulfilled")).toBe(true);
    expect((await kudos.kudoSummaryForViewer(flight.id, viewer.id)).count).toBe(1);
  });
});
