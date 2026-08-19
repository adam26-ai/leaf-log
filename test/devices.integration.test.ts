// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

import { makeRealisticFlight } from "./igc/make-igc";

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("device tokens", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/devices/repo");
  let pairingRepo: typeof import("@/lib/devices/pairing-repo");
  let hashDeviceKey: typeof import("@/lib/devices/token").hashDeviceKey;
  let pairingHelpers: typeof import("@/lib/devices/pairing");
  let ingestFlight: typeof import("@/lib/ingest/ingest-flight").ingestFlight;
  let flightsRepo: typeof import("@/lib/flights/repo");
  let ownerId = "";
  let otherId = "";
  const pairingCodeHashes: string[] = [];
  const pairingHandleHashes: string[] = [];

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/devices/repo");
    pairingRepo = await import("@/lib/devices/pairing-repo");
    ({ hashDeviceKey } = await import("@/lib/devices/token"));
    pairingHelpers = await import("@/lib/devices/pairing");
    ({ ingestFlight } = await import("@/lib/ingest/ingest-flight"));
    flightsRepo = await import("@/lib/flights/repo");

    const owner = await prisma.user.create({
      data: {
        email: `device_owner_${suffix}@test.local`,
        profile: {
          create: {
            handle: `devowner${suffix}`,
            displayName: "Owner",
            defaultVisibility: "public",
          },
        },
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
    await prisma.devicePairing.deleteMany({
      where: {
        OR: [
          { claimedByOwnerId: { in: [ownerId, otherId] } },
          { codeHash: { in: pairingCodeHashes } },
          { pollHandleHash: { in: pairingHandleHashes } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });

  async function startTrackedPairing() {
    const pairing = await pairingRepo.startPairing();
    pairingCodeHashes.push(pairingHelpers.hashCode(pairing.code));
    pairingHandleHashes.push(pairingHelpers.hashHandle(pairing.pollHandle));
    return pairing;
  }

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
      account: { handle: `devowner${suffix}`, displayName: "Owner" },
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
      account: { handle: `devowner${suffix}`, displayName: "Owner" },
    });

    expect(await repo.revokeDeviceToken(token.id, ownerId)).toBe(true);
    expect(await repo.resolveDeviceTokenOwner(plaintext)).toBeNull();
  });

  it("records the latest flight reference and resolves it through an owner-scoped read", async () => {
    const { token } = await repo.createDeviceToken(ownerId, "Touch");
    const { igc } = makeRealisticFlight();
    const flight = await ingestFlight({
      ownerId,
      bytes: new TextEncoder().encode(`${igc}LTOUCH:${suffix}\n`),
    });
    const before = await prisma.deviceToken.findUnique({
      where: { id: token.id },
      select: { lastUsedAt: true },
    });
    expect(before?.lastUsedAt).toBeNull();

    await repo.touchDeviceToken(token.id, flight.flightId);
    const after = await prisma.deviceToken.findUnique({
      where: { id: token.id },
      select: { lastUsedAt: true, lastFlightId: true },
    });
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
    expect(after?.lastFlightId).toBe(flight.flightId);

    const listed = await repo.listDeviceTokens(ownerId);
    expect(listed.find((row) => row.id === token.id)?.lastFlightId).toBe(
      flight.flightId,
    );
    expect(
      await flightsRepo.listOwnFlightsByIds(ownerId, [flight.flightId]),
    ).toHaveLength(1);

    const otherFlight = await ingestFlight({
      ownerId: otherId,
      bytes: new TextEncoder().encode(`${igc}LOTHER:${suffix}\n`),
    });
    await prisma.deviceToken.update({
      where: { id: token.id },
      data: { lastFlightId: otherFlight.flightId },
    });
    expect(
      await flightsRepo.listOwnFlightsByIds(ownerId, [otherFlight.flightId]),
    ).toEqual([]);
  });

  it("self-revokes an active plaintext token", async () => {
    const { plaintext } = await repo.createDeviceToken(ownerId, "Self revoke");
    expect(await repo.revokeDeviceTokenByPlaintext(plaintext)).toBe(true);
    expect(await repo.revokeDeviceTokenByPlaintext(plaintext)).toBe(false);
    expect(await repo.resolveDeviceTokenOwner(plaintext)).toBeNull();
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

  it("runs the full pairing state machine and delivers the token once", async () => {
    const pairing = await startTrackedPairing();

    expect(await pairingRepo.pollPairing(pairing.pollHandle)).toEqual({
      status: "pending",
    });
    expect(await pairingRepo.claimPairing(ownerId, "WRONG1", "Wrong")).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });

    const claimed = await pairingRepo.claimPairing(
      ownerId,
      ` ${pairing.code.slice(0, 3).toLowerCase()}-${pairing.code.slice(3)} `,
      "Cockpit Leaf",
    );
    expect(claimed.ok).toBe(true);

    const storedPairing = await prisma.devicePairing.findUnique({
      where: { codeHash: pairingHelpers.hashCode(pairing.code) },
      select: {
        status: true,
        claimedByOwnerId: true,
        deviceTokenId: true,
        tokenPlaintext: true,
        label: true,
      },
    });
    expect(storedPairing).toMatchObject({
      status: "claimed",
      claimedByOwnerId: ownerId,
      label: "Cockpit Leaf",
    });
    expect(storedPairing?.deviceTokenId).toBeTruthy();
    expect(storedPairing?.tokenPlaintext).toMatch(/^llk_/);

    const token = await prisma.deviceToken.findUnique({
      where: { id: storedPairing?.deviceTokenId ?? "" },
      select: { ownerId: true, label: true },
    });
    expect(token).toEqual({ ownerId, label: "Cockpit Leaf" });

    const firstPoll = await pairingRepo.pollPairing(pairing.pollHandle);
    expect(firstPoll.status).toBe("claimed");
    if (firstPoll.status !== "claimed") throw new Error("Expected claimed poll");
    expect(firstPoll.token).toMatch(/^llk_/);
    expect(firstPoll.account).toEqual({
      handle: `devowner${suffix}`,
      displayName: "Owner",
    });
    expect(await repo.resolveDeviceTokenOwner(firstPoll.token)).toEqual({
      ownerId,
      tokenId: storedPairing?.deviceTokenId,
      account: { handle: `devowner${suffix}`, displayName: "Owner" },
    });

    const consumedPairing = await prisma.devicePairing.findUnique({
      where: { codeHash: pairingHelpers.hashCode(pairing.code) },
      select: { status: true, tokenPlaintext: true },
    });
    expect(consumedPairing).toEqual({
      status: "consumed",
      tokenPlaintext: null,
    });

    expect(await pairingRepo.pollPairing(pairing.pollHandle)).toEqual({
      status: "consumed",
    });
  });

  it("does not claim expired codes or report unknown handles as claimed", async () => {
    const expiredCode = `EXPIRED${suffix}`;
    const expiredHandle = `expired-${suffix}`;
    pairingCodeHashes.push(pairingHelpers.hashCode(expiredCode));
    pairingHandleHashes.push(pairingHelpers.hashHandle(expiredHandle));
    await prisma.devicePairing.create({
      data: {
        codeHash: pairingHelpers.hashCode(expiredCode),
        pollHandleHash: pairingHelpers.hashHandle(expiredHandle),
        status: "pending",
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    expect(await pairingRepo.claimPairing(ownerId, expiredCode, "Expired")).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
    expect(await pairingRepo.pollPairing(`missing-${suffix}`)).not.toMatchObject({
      status: "claimed",
    });
  });

  it("consumes and scrubs malformed claimed pairings", async () => {
    const cases = [
      { name: "missing owner id", claimedByOwnerId: null },
      { name: "missing owner profile", claimedByOwnerId: `missing-${suffix}` },
    ];

    for (const pairingCase of cases) {
      const code = `BROKEN-${pairingCase.name}-${suffix}`;
      const pollHandle = `broken-${pairingCase.name}-${suffix}`;
      const codeHash = pairingHelpers.hashCode(code);
      const pollHandleHash = pairingHelpers.hashHandle(pollHandle);
      pairingCodeHashes.push(codeHash);
      pairingHandleHashes.push(pollHandleHash);
      const pairing = await prisma.devicePairing.create({
        data: {
          codeHash,
          pollHandleHash,
          status: "claimed",
          claimedByOwnerId: pairingCase.claimedByOwnerId,
          tokenPlaintext: `llk_dangling_${suffix}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      expect(await pairingRepo.pollPairing(pollHandle)).toEqual({
        status: "consumed",
      });
      expect(
        await prisma.devicePairing.findUnique({
          where: { id: pairing.id },
          select: { status: true, tokenPlaintext: true },
        }),
      ).toEqual({ status: "consumed", tokenPlaintext: null });
    }
  });

  it("uses a paired token to ingest device-pushed flights honoring the owner's default visibility", async () => {
    const pairing = await startTrackedPairing();
    const claimed = await pairingRepo.claimPairing(ownerId, pairing.code, "Wing pod");
    expect(claimed.ok).toBe(true);

    const polled = await pairingRepo.pollPairing(pairing.pollHandle);
    expect(polled.status).toBe("claimed");
    if (polled.status !== "claimed") throw new Error("Expected claimed poll");

    const resolved = await repo.resolveDeviceTokenOwner(polled.token);
    expect(resolved?.ownerId).toBe(ownerId);

    const { igc } = makeRealisticFlight();
    const bytes = new TextEncoder().encode(`${igc}LTESTPAIR:${suffix}\n`);
    const result = await ingestFlight({
      ownerId: resolved?.ownerId ?? "",
      source: "device_push",
      bytes,
    });

    const flight = await prisma.flight.findUnique({
      where: { id: result.flightId },
      select: { ownerId: true, source: true, visibility: true },
    });
    // The test owner's defaultVisibility is "public" — device pushes now honor it.
    expect(flight).toEqual({
      ownerId,
      source: "device_push",
      visibility: "public",
    });
  });
});
