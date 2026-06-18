// @vitest-environment node
//
// Privacy invariant via the app-layer repo (this app has no DB RLS — the repo IS
// the enforcement). Requires a local Postgres; skips when DATABASE_URL is unset.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const enabled = Boolean(process.env.DATABASE_URL);
const d = enabled ? describe : describe.skip;

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

d("privacy invariant (app-layer repo)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/flights/repo");
  let ownerId = "";
  let otherId = "";
  let publicFlightId = "";
  let privateFlightId = "";

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/flights/repo");

    const owner = await prisma.user.create({
      data: { email: `owner_${suffix}@test.local`, profile: { create: { handle: `owner${suffix}`, displayName: "Owner" } } },
    });
    ownerId = owner.id;
    const other = await prisma.user.create({
      data: { email: `other_${suffix}@test.local`, profile: { create: { handle: `other${suffix}`, displayName: "Other" } } },
    });
    otherId = other.id;

    const pub = await prisma.flight.create({
      data: { ownerId, visibility: "public", status: "ready", igcSha256: `pub${suffix}`, durationS: 100 },
    });
    publicFlightId = pub.id;
    const priv = await prisma.flight.create({
      data: { ownerId, visibility: "private", status: "ready", igcSha256: `priv${suffix}`, durationS: 200 },
    });
    privateFlightId = priv.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });

  it("anonymous viewers get public flights but not private ones", async () => {
    expect(await repo.getFlightForViewer(publicFlightId, null)).not.toBeNull();
    expect(await repo.getFlightForViewer(privateFlightId, null)).toBeNull();
  });

  it("an authenticated non-owner cannot see a private flight", async () => {
    expect(await repo.getFlightForViewer(privateFlightId, otherId)).toBeNull();
  });

  it("the owner can see their private flight", async () => {
    expect(await repo.getFlightForViewer(privateFlightId, ownerId)).not.toBeNull();
  });

  it("public listing excludes private flights; own listing includes them", async () => {
    const pub = await repo.listPublicFlights(ownerId);
    expect(pub.map((f) => f.id)).toEqual([publicFlightId]);
    const own = await repo.listOwnFlights(ownerId);
    expect(own).toHaveLength(2);
  });
});
