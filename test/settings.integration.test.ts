// @vitest-environment node
//
// Profile-settings invariants: new flights inherit the owner's default
// visibility, and avatar storage/serve behaves (public by handle). Requires a
// local Postgres; skips when DATABASE_URL is unset.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

import { makeRealisticFlight } from "./igc/make-igc";

const enabled = Boolean(process.env.DATABASE_URL);
const d = enabled ? describe : describe.skip;
const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

d("profile settings", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let ingestFlight: typeof import("@/lib/ingest/ingest-flight").ingestFlight;
  let avatarRepo: typeof import("@/lib/avatar/repo");
  let processAvatar: typeof import("@/lib/avatar/process").processAvatar;
  let sharp: typeof import("sharp").default;
  let publicOwnerId = "";
  let privateOwnerId = "";
  let publicHandle = `pub${suffix}`;
  let privateHandle = `prv${suffix}`;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    ({ ingestFlight } = await import("@/lib/ingest/ingest-flight"));
    avatarRepo = await import("@/lib/avatar/repo");
    ({ processAvatar } = await import("@/lib/avatar/process"));
    sharp = (await import("sharp")).default;

    const pub = await prisma.user.create({
      data: {
        email: `pub_${suffix}@test.local`,
        profile: {
          create: { handle: publicHandle, displayName: "Pub", defaultVisibility: "public" },
        },
      },
    });
    publicOwnerId = pub.id;
    const prv = await prisma.user.create({
      data: {
        email: `prv_${suffix}@test.local`,
        profile: { create: { handle: privateHandle, displayName: "Prv" } }, // defaults to private
      },
    });
    privateOwnerId = prv.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { ownerId: { in: [publicOwnerId, privateOwnerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [publicOwnerId, privateOwnerId] } } });
    await prisma.$disconnect();
  });

  it("new flights inherit the owner's default visibility", async () => {
    const { igc } = makeRealisticFlight();
    const bytes = new TextEncoder().encode(igc);

    const pubRes = await ingestFlight({ ownerId: publicOwnerId, bytes });
    const pubFlight = await prisma.flight.findUnique({
      where: { id: pubRes.flightId },
      select: { visibility: true },
    });
    expect(pubFlight?.visibility).toBe("public");

    const prvRes = await ingestFlight({ ownerId: privateOwnerId, bytes });
    const prvFlight = await prisma.flight.findUnique({
      where: { id: prvRes.flightId },
      select: { visibility: true },
    });
    expect(prvFlight?.visibility).toBe("private");
  });

  it("stores, serves by handle, and removes an avatar", async () => {
    const src = await sharp({
      create: { width: 400, height: 250, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();
    const processed = await processAvatar(src, "image/jpeg", "a.jpg");

    await avatarRepo.setAvatar(publicOwnerId, processed, new Date());
    const full = await avatarRepo.getAvatarBytes(publicHandle, "full");
    const thumb = await avatarRepo.getAvatarBytes(publicHandle, "thumb");
    expect(full && full.length).toBeGreaterThan(0);
    expect(thumb && thumb.length).toBeGreaterThan(0);

    // The profile is stamped (drives the "has avatar" UI + cache key).
    const stamped = await prisma.profile.findUnique({
      where: { id: publicOwnerId },
      select: { avatarUpdatedAt: true },
    });
    expect(stamped?.avatarUpdatedAt).toBeTruthy();

    // No avatar for a profile that never uploaded one.
    expect(await avatarRepo.getAvatarBytes(privateHandle, "thumb")).toBeNull();

    await avatarRepo.removeAvatar(publicOwnerId);
    expect(await avatarRepo.getAvatarBytes(publicHandle, "full")).toBeNull();
    const cleared = await prisma.profile.findUnique({
      where: { id: publicOwnerId },
      select: { avatarUpdatedAt: true },
    });
    expect(cleared?.avatarUpdatedAt).toBeNull();
  });
});
