// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

import { makeRealisticFlight } from "./igc/make-igc";

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("device tokens", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/devices/repo");
  let hashDeviceKey: typeof import("@/lib/devices/token").hashDeviceKey;
  let ingestFlight: typeof import("@/lib/ingest/ingest-flight").ingestFlight;
  let ownerId = "";
  let otherId = "";

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/devices/repo");
    ({ hashDeviceKey } = await import("@/lib/devices/token"));
    ({ ingestFlight } = await import("@/lib/ingest/ingest-flight"));

    const owner = await prisma.user.create({
      data: {
        email: `device_owner_${suffix}@test.local`,
        profile: { create: { handle: `devowner${suffix}`, displayName: "Owner" } },
      },
    });
    ownerId = owner.id;
    const other = await prisma.user.create({
      data: {
        email: `device_other_${suffix}@test.local`,
        profile: { create: { handle: `devother${suffix}`, displayName: "Other" } },
      },
    });
    otherId = other.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });

  it("stores a hash, returns plaintext once, and resolves active keys only", async () => {
    const { plaintext, token } = await repo.createDeviceToken(
      ownerId,
      "Harness",
      "AA:BB",
    );

    const stored = await prisma.deviceToken.findUnique({
      where: { id: token.id },
      select: { tokenHash: true, label: true, deviceId: true },
    });
    expect(stored?.label).toBe("Harness");
    expect(stored?.deviceId).toBe("AA:BB");
    expect(stored?.tokenHash).toBe(hashDeviceKey(plaintext));
    expect(stored?.tokenHash).not.toBe(plaintext);
    expect(token).not.toHaveProperty("tokenHash");

    expect(await repo.resolveDeviceTokenOwner(plaintext)).toEqual({
      ownerId,
      tokenId: token.id,
    });
    expect(await repo.resolveDeviceTokenOwner("llk_garbage")).toBeNull();

    await repo.revokeDeviceToken(token.id, ownerId);
    expect(await repo.resolveDeviceTokenOwner(plaintext)).toBeNull();
  });

  it("revokes owner-scoped keys only", async () => {
    const { plaintext, token } = await repo.createDeviceToken(ownerId, "Scoped");

    expect(await repo.revokeDeviceToken(token.id, otherId)).toBe(false);
    expect(await repo.resolveDeviceTokenOwner(plaintext)).toEqual({
      ownerId,
      tokenId: token.id,
    });

    expect(await repo.revokeDeviceToken(token.id, ownerId)).toBe(true);
    expect(await repo.resolveDeviceTokenOwner(plaintext)).toBeNull();
  });

  it("touches lastUsedAt", async () => {
    const { token } = await repo.createDeviceToken(ownerId, "Touch");
    const before = await prisma.deviceToken.findUnique({
      where: { id: token.id },
      select: { lastUsedAt: true },
    });
    expect(before?.lastUsedAt).toBeNull();

    await repo.touchDeviceToken(token.id);
    const after = await prisma.deviceToken.findUnique({
      where: { id: token.id },
      select: { lastUsedAt: true },
    });
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("resolves a generated key and ingests device-pushed flights with dedupe", async () => {
    const { plaintext } = await repo.createDeviceToken(ownerId, "Vario");
    const resolved = await repo.resolveDeviceTokenOwner(plaintext);
    expect(resolved?.ownerId).toBe(ownerId);

    const { igc } = makeRealisticFlight();
    const bytes = new TextEncoder().encode(igc);
    const first = await ingestFlight({
      ownerId: resolved?.ownerId ?? "",
      source: "device_push",
      bytes,
    });

    const flight = await prisma.flight.findUnique({
      where: { id: first.flightId },
      select: { ownerId: true, source: true },
    });
    expect(flight).toEqual({ ownerId, source: "device_push" });
    expect(first.deduped).toBe(false);

    const second = await ingestFlight({
      ownerId,
      source: "device_push",
      bytes,
    });
    expect(second.flightId).toBe(first.flightId);
    expect(second.deduped).toBe(true);
  });
});
