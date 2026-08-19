import { prisma } from "@/lib/prisma";
import { generateDeviceKey, hashDeviceKey } from "./token";

export interface DeviceAccountIdentity {
  handle: string;
  displayName: string;
}

type DeviceTokenDb = {
  deviceToken: {
    create: typeof prisma.deviceToken.create;
  };
};

const deviceTokenSelect = {
  id: true,
  label: true,
  deviceId: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
  lastFlightId: true,
} as const;

export interface DeviceTokenListItem {
  id: string;
  label: string;
  deviceId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  lastFlightId: string | null;
}

export async function createDeviceToken(
  ownerId: string,
  label: string,
  deviceId?: string | null,
  db: DeviceTokenDb = prisma,
): Promise<{ plaintext: string; token: DeviceTokenListItem }> {
  const { plaintext, hash } = generateDeviceKey();
  const token = await db.deviceToken.create({
    data: {
      ownerId,
      tokenHash: hash,
      label,
      deviceId: deviceId || null,
    },
    select: deviceTokenSelect,
  });
  return { plaintext, token };
}

export function listDeviceTokens(ownerId: string): Promise<DeviceTokenListItem[]> {
  return prisma.deviceToken.findMany({
    where: { ownerId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: deviceTokenSelect,
  });
}

export async function revokeDeviceToken(id: string, ownerId: string): Promise<boolean> {
  const res = await prisma.deviceToken.updateMany({
    where: { id, ownerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

export async function resolveDeviceTokenOwner(
  plaintext: string,
): Promise<{
  ownerId: string;
  tokenId: string;
  account: DeviceAccountIdentity;
} | null> {
  const token = await prisma.deviceToken.findUnique({
    where: { tokenHash: hashDeviceKey(plaintext) },
    select: {
      id: true,
      ownerId: true,
      revokedAt: true,
      owner: { select: { handle: true, displayName: true } },
    },
  });
  if (!token || token.revokedAt) return null;
  return { ownerId: token.ownerId, tokenId: token.id, account: token.owner };
}

export async function touchDeviceToken(
  tokenId: string,
  lastFlightId: string,
): Promise<void> {
  await prisma.deviceToken.update({
    where: { id: tokenId },
    data: { lastUsedAt: new Date(), lastFlightId },
  });
}

export async function revokeDeviceTokenByPlaintext(
  plaintext: string,
): Promise<boolean> {
  const result = await prisma.deviceToken.updateMany({
    where: {
      tokenHash: hashDeviceKey(plaintext),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}
