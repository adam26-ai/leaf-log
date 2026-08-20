// @vitest-environment node
//
// Privacy invariant via the app-layer repo (this app has no DB RLS — the repo IS
// the enforcement). Requires a local Postgres and must not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

import { makeRealisticFlight } from "./igc/make-igc";

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("privacy invariant (app-layer repo)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/flights/repo");
  let photosRepo: typeof import("@/lib/photos/repo");
  let ingestFlight: typeof import("@/lib/ingest/ingest-flight").ingestFlight;
  let removeFriend: typeof import("@/lib/social/friends").removeFriend;

  let ownerId = "";
  let friendId = "";
  let pendingId = "";
  let strangerId = "";
  let friendsDefaultOwnerId = "";
  let publicFlightId = "";
  let friendsFlightId = "";
  let privateFlightId = "";
  let uploadedFlightId = "";
  let failedFlightId = "";
  let friendsPhotoId = "";
  const siteIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for privacy integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/flights/repo");
    photosRepo = await import("@/lib/photos/repo");
    ({ ingestFlight } = await import("@/lib/ingest/ingest-flight"));
    ({ removeFriend } = await import("@/lib/social/friends"));

    const [owner, friend, pending, stranger, friendsDefaultOwner] =
      await Promise.all([
        prisma.user.create({
          data: {
            email: `owner_${suffix}@test.local`,
            profile: {
              create: { handle: `owner${suffix}`, displayName: "Owner" },
            },
          },
        }),
        prisma.user.create({
          data: {
            email: `friend_${suffix}@test.local`,
            profile: {
              create: { handle: `friend${suffix}`, displayName: "Friend" },
            },
          },
        }),
        prisma.user.create({
          data: {
            email: `pending_${suffix}@test.local`,
            profile: {
              create: { handle: `pending${suffix}`, displayName: "Pending" },
            },
          },
        }),
        prisma.user.create({
          data: {
            email: `stranger_${suffix}@test.local`,
            profile: {
              create: { handle: `stranger${suffix}`, displayName: "Stranger" },
            },
          },
        }),
        prisma.user.create({
          data: {
            email: `friends_default_${suffix}@test.local`,
            profile: {
              create: {
                handle: `fdef${suffix}`,
                displayName: "Friends Default",
                defaultVisibility: "friends",
              },
            },
          },
        }),
      ]);

    ownerId = owner.id;
    friendId = friend.id;
    pendingId = pending.id;
    strangerId = stranger.id;
    friendsDefaultOwnerId = friendsDefaultOwner.id;

    await prisma.friendship.createMany({
      data: [
        { requesterId: ownerId, addresseeId: friendId, status: "accepted" },
        { requesterId: pendingId, addresseeId: ownerId, status: "pending" },
      ],
    });

    const sites = await Promise.all(
      [1, 2, 3].map((n) =>
        prisma.site.create({
          data: {
            name: `Privacy Site ${n} ${suffix}`,
            normalizedName: `privacy site ${n} ${suffix}`.toLowerCase(),
            kind: "takeoff",
            lat: 37 + n / 100,
            lon: -122 - n / 100,
            visibility: "public",
            ownerId: null,
          },
        }),
      ),
    );
    siteIds.push(...sites.map((site) => site.id));

    const [pub, friends, priv, uploaded, failed] = await Promise.all([
      prisma.flight.create({
        data: {
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `pub${suffix}`,
          durationS: 100,
          flightDate: new Date("2026-06-01T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
          takeoffSiteId: siteIds[0],
        },
      }),
      prisma.flight.create({
        data: {
          ownerId,
          visibility: "friends",
          status: "ready",
          igcSha256: `friends${suffix}`,
          durationS: 200,
          flightDate: new Date("2026-06-02T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-02T10:00:00.000Z"),
          takeoffSiteId: siteIds[1],
          data: {
            create: {
              rawIgc: Buffer.from("AXXX\nHFDTE010626\n"),
              track: { points: [] },
            },
          },
        },
      }),
      prisma.flight.create({
        data: {
          ownerId,
          visibility: "private",
          status: "ready",
          igcSha256: `priv${suffix}`,
          durationS: 300,
          flightDate: new Date("2026-06-03T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-03T10:00:00.000Z"),
          takeoffSiteId: siteIds[2],
        },
      }),
      prisma.flight.create({
        data: {
          ownerId,
          visibility: "private",
          status: "uploaded",
          igcSha256: `uploaded${suffix}`,
        },
      }),
      prisma.flight.create({
        data: {
          ownerId,
          visibility: "friends",
          status: "failed",
          igcSha256: `failed${suffix}`,
          failureReason: "test failure",
        },
      }),
    ]);

    publicFlightId = pub.id;
    friendsFlightId = friends.id;
    privateFlightId = priv.id;
    uploadedFlightId = uploaded.id;
    failedFlightId = failed.id;

    const photo = await prisma.photo.create({
      data: {
        flightId: friendsFlightId,
        originalFilename: "friends.jpg",
        contentType: "image/jpeg",
        displayWidth: 2,
        displayHeight: 2,
        displayBytes: 4,
        thumbWidth: 1,
        thumbHeight: 1,
        thumbBytes: 4,
        sha256: `photo${suffix}`,
        data: {
          create: {
            display: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
            thumb: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          },
        },
      },
    });
    friendsPhotoId = photo.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({
      where: { ownerId: { in: [ownerId, friendsDefaultOwnerId] } },
    });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerId, friendId, pendingId, strangerId, friendsDefaultOwnerId],
        },
      },
    });
    await prisma.$disconnect();
  });

  it("enforces the full getFlightForViewer matrix", async () => {
    const viewers: Array<{
      name: string;
      viewerId: string | null;
      visible: Record<"public" | "friends" | "private", boolean>;
    }> = [
      {
        name: "owner",
        viewerId: ownerId,
        visible: { public: true, friends: true, private: true },
      },
      {
        name: "accepted friend",
        viewerId: friendId,
        visible: { public: true, friends: true, private: false },
      },
      {
        name: "pending requester",
        viewerId: pendingId,
        visible: { public: true, friends: false, private: false },
      },
      {
        name: "signed-in stranger",
        viewerId: strangerId,
        visible: { public: true, friends: false, private: false },
      },
      {
        name: "anonymous",
        viewerId: null,
        visible: { public: true, friends: false, private: false },
      },
    ];

    const flights = {
      public: publicFlightId,
      friends: friendsFlightId,
      private: privateFlightId,
    };

    for (const viewer of viewers) {
      for (const [visibility, flightId] of Object.entries(flights) as Array<
        [keyof typeof flights, string]
      >) {
        const flight = await repo.getFlightForViewer(flightId, viewer.viewerId);
        expect(
          flight !== null,
          `${viewer.name} against ${visibility} flight`,
        ).toBe(viewer.visible[visibility]);
      }
    }
  });

  it("lets the owner see non-ready uploads and failures", async () => {
    expect(await repo.getFlightForViewer(uploadedFlightId, ownerId)).not.toBeNull();
    expect(await repo.getFlightForViewer(failedFlightId, ownerId)).not.toBeNull();
  });

  it("lists profile flights and stats from the viewer-filtered rows", async () => {
    const anon = await repo.listProfileFlightsForViewer(ownerId, null);
    const stranger = await repo.listProfileFlightsForViewer(ownerId, strangerId);
    const friend = await repo.listProfileFlightsForViewer(ownerId, friendId);
    const owner = await repo.listProfileFlightsForViewer(ownerId, ownerId);

    expect(anon.map((f) => f.id)).toEqual([publicFlightId]);
    expect(stranger.map((f) => f.id)).toEqual([publicFlightId]);
    expect(friend.map((f) => f.id)).toEqual([friendsFlightId, publicFlightId]);
    expect(owner.map((f) => f.id)).toEqual([
      privateFlightId,
      friendsFlightId,
      publicFlightId,
    ]);

    expect(repo.statsFrom(anon)).toEqual({
      totalSeconds: 100,
      flightCount: 1,
      siteCount: 1,
    });
    expect(repo.statsFrom(friend)).toEqual({
      totalSeconds: 300,
      flightCount: 2,
      siteCount: 2,
    });
    expect(repo.statsFrom(owner)).toEqual({
      totalSeconds: 600,
      flightCount: 3,
      siteCount: 3,
    });
  });

  it("keeps listPublicFlights as the anonymous profile view", async () => {
    expect((await repo.listPublicFlights(ownerId)).map((f) => f.id)).toEqual([
      publicFlightId,
    ]);
  });

  it("ingest honors a friends default visibility", async () => {
    const { igc } = makeRealisticFlight();
    const result = await ingestFlight({
      ownerId: friendsDefaultOwnerId,
      bytes: new TextEncoder().encode(igc),
    });
    const flight = await prisma.flight.findUnique({
      where: { id: result.flightId },
      select: { visibility: true },
    });
    expect(flight?.visibility).toBe("friends");
  });

  it("denies friends-only on the next read after revocation", async () => {
    expect(await repo.getFlightForViewer(friendsFlightId, friendId)).not.toBeNull();
    await removeFriend(ownerId, friendId);
    expect(await repo.getFlightForViewer(friendsFlightId, friendId)).toBeNull();
  });

  it("authorizes subresource access through the same visibility decision", async () => {
    await prisma.friendship.upsert({
      where: {
        requesterId_addresseeId: { requesterId: ownerId, addresseeId: friendId },
      },
      create: { requesterId: ownerId, addresseeId: friendId, status: "accepted" },
      update: { status: "accepted", respondedAt: new Date() },
    });

    expect(await repo.getFlightForViewer(friendsFlightId, strangerId)).toBeNull();
    expect(await repo.getFlightForViewer(friendsFlightId, friendId)).not.toBeNull();

    expect(await photosRepo.listPhotosForViewer(friendsFlightId, strangerId)).toBeNull();
    expect(
      (await photosRepo.listPhotosForViewer(friendsFlightId, friendId))?.map(
        (photo) => photo.id,
      ),
    ).toEqual([friendsPhotoId]);

    expect(
      await photosRepo.getPhotoBytesForViewer(
        friendsFlightId,
        friendsPhotoId,
        strangerId,
        "thumb",
      ),
    ).toBeNull();
    expect(
      await photosRepo.getPhotoBytesForViewer(
        friendsFlightId,
        friendsPhotoId,
        friendId,
        "thumb",
      ),
    ).not.toBeNull();
  });
});
