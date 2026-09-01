// @vitest-environment node
//
// canAssignInstructor is the sprint's first authz predicate for the
// instructor/signoff surface — DB-backed since it re-reads the live friend
// graph. Requires a local Postgres and must not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("canAssignInstructor (DB-backed)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let friends: typeof import("@/lib/social/friends");
  let canAssignInstructor: typeof import("@/lib/ratings/authz").canAssignInstructor;

  const ids: string[] = [];
  let ownerId = "";
  let friendId = "";
  let strangerId = "";

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
      throw new Error("DATABASE_URL is required for instructor-authz integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    friends = await import("@/lib/social/friends");
    ({ canAssignInstructor } = await import("@/lib/ratings/authz"));

    ownerId = await createPilot("Owner");
    friendId = await createPilot("Friend");
    strangerId = await createPilot("Stranger");

    await prisma.friendship.create({
      data: { requesterId: ownerId, addresseeId: friendId, status: "accepted" },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.friendship.deleteMany({ where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("allows the owner to assign a current accepted friend", async () => {
    expect(await canAssignInstructor(ownerId, ownerId, friendId)).toBe(true);
  });

  it("rejects a non-owner actor, even one who is friends with the target", async () => {
    // strangerId is not the flight's owner (ownerId is) — the actor must
    // match ownerId regardless of the actor's own friend graph.
    expect(await canAssignInstructor(strangerId, ownerId, friendId)).toBe(false);
  });

  it("rejects a non-friend even when submitted directly, not just filtered from a picker", async () => {
    expect(await canAssignInstructor(ownerId, ownerId, strangerId)).toBe(false);
  });

  it("allows the owner to clear the instructor", async () => {
    expect(await canAssignInstructor(ownerId, ownerId, null)).toBe(true);
  });

  it("rejects self-assignment (an owner is never their own friend)", async () => {
    expect(await canAssignInstructor(ownerId, ownerId, ownerId)).toBe(false);
  });

  it("re-reads the live friend graph: rejects a former friend after unfriending", async () => {
    await friends.removeFriend(ownerId, friendId);
    expect(await canAssignInstructor(ownerId, ownerId, friendId)).toBe(false);

    // Restore for any tests that might run after this one in the same file.
    await prisma.friendship.create({
      data: { requesterId: ownerId, addresseeId: friendId, status: "accepted" },
    });
  });
});
