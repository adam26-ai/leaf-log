// @vitest-environment node
//
// Friend graph invariants. Requires a local Postgres; skips only when
// DATABASE_URL is unset, matching the other integration tests.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const enabled = Boolean(process.env.DATABASE_URL);
const d = enabled ? describe : describe.skip;
const suffix = `${process.pid}${Math.floor(Math.random() * 1e5)}`;

d("friend graph", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let friends: typeof import("@/lib/social/friends");
  const ids: string[] = [];

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

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    friends = await import("@/lib/social/friends");
  });

  beforeEach(async () => {
    await prisma.friendship.deleteMany({
      where: {
        OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }],
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
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
});
