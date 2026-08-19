import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createDeviceToken, type DeviceAccountIdentity } from "./repo";
import {
  PAIRING_TTL_MS,
  generatePairingCode,
  generatePollHandle,
  hashCode,
  hashHandle,
  normalizeCode,
} from "./pairing";

const DEFAULT_LABEL = "Leaf device";
const MAX_START_ATTEMPTS = 5;

export type ClaimPairingResult =
  | { ok: true; deviceTokenId: string }
  | { ok: false; error: "invalid_or_expired" };

export type PollPairingResult =
  | { status: "pending" }
  | { status: "claimed"; token: string; account: DeviceAccountIdentity }
  | { status: "consumed" }
  | { status: "expired" }
  | { status: "unknown" };

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function cleanLabel(label?: string | null): string {
  const trimmed = label?.trim();
  return trimmed || DEFAULT_LABEL;
}

export async function startPairing(): Promise<{
  code: string;
  pollHandle: string;
  expiresAt: Date;
}> {
  for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt += 1) {
    const code = generatePairingCode();
    const pollHandle = generatePollHandle();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

    try {
      await prisma.devicePairing.create({
        data: {
          codeHash: hashCode(code),
          pollHandleHash: hashHandle(pollHandle),
          status: "pending",
          expiresAt,
        },
      });
      return { code, pollHandle, expiresAt };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === MAX_START_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new Error("Could not create device pairing");
}

export async function claimPairing(
  ownerId: string,
  rawCode: string,
  label?: string | null,
): Promise<ClaimPairingResult> {
  const normalized = normalizeCode(rawCode);
  if (!normalized) return { ok: false, error: "invalid_or_expired" };

  const codeHash = hashCode(normalized);
  const now = new Date();
  const deviceLabel = cleanLabel(label);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.devicePairing.updateMany({
      where: {
        codeHash,
        status: "pending",
        expiresAt: { gt: now },
      },
      data: {
        status: "claimed",
        claimedByOwnerId: ownerId,
        label: deviceLabel,
      },
    });

    if (claimed.count !== 1) {
      return { ok: false, error: "invalid_or_expired" };
    }

    const pairing = await tx.devicePairing.findUnique({
      where: { codeHash },
      select: { id: true },
    });
    if (!pairing) {
      throw new Error("Claimed pairing could not be reloaded");
    }

    const { plaintext, token } = await createDeviceToken(
      ownerId,
      deviceLabel,
      null,
      tx,
    );
    await tx.devicePairing.update({
      where: { id: pairing.id },
      data: {
        deviceTokenId: token.id,
        tokenPlaintext: plaintext,
      },
    });

    return { ok: true, deviceTokenId: token.id };
  });
}

export async function pollPairing(rawPollHandle: string): Promise<PollPairingResult> {
  const pollHandle = rawPollHandle.trim();
  if (!pollHandle) return { status: "unknown" };

  const pairing = await prisma.devicePairing.findUnique({
    where: { pollHandleHash: hashHandle(pollHandle) },
    select: {
      id: true,
      status: true,
      tokenPlaintext: true,
      expiresAt: true,
      claimedByOwnerId: true,
    },
  });

  if (!pairing) return { status: "unknown" };

  if (pairing.expiresAt <= new Date()) {
    await prisma.devicePairing.updateMany({
      where: { id: pairing.id, tokenPlaintext: { not: null } },
      data: { tokenPlaintext: null },
    });
    return { status: "expired" };
  }

  if (pairing.status === "pending") return { status: "pending" };

  if (pairing.status === "claimed") {
    const token = pairing.tokenPlaintext;
    if (!token) return { status: "consumed" };

    if (!pairing.claimedByOwnerId) return { status: "consumed" };
    const account = await prisma.profile.findUnique({
      where: { id: pairing.claimedByOwnerId },
      select: { handle: true, displayName: true },
    });
    if (!account) throw new Error("Claimed pairing owner could not be loaded");

    const consumed = await prisma.devicePairing.updateMany({
      where: {
        id: pairing.id,
        status: "claimed",
        tokenPlaintext: { not: null },
      },
      data: {
        status: "consumed",
        tokenPlaintext: null,
      },
    });

    if (consumed.count !== 1) return { status: "consumed" };
    return { status: "claimed", token, account };
  }

  return { status: "consumed" };
}
