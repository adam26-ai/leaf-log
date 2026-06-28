import { prisma } from "@/lib/prisma";
import type { Friendship, Profile } from "@prisma/client";

export type FriendState = "self" | "none" | "outgoing" | "incoming" | "friends";
export type SearchPilotState = Exclude<FriendState, "self">;

export type SearchPilotResult = {
  id: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | null;
  state: SearchPilotState;
};

export type FriendshipWithRequester = Friendship & { requester: Profile };
export type FriendshipWithAddressee = Friendship & { addressee: Profile };

export async function areFriends(aId: string, bId: string): Promise<boolean> {
  if (aId === bId) return false;
  const count = await prisma.friendship.count({
    where: {
      status: "accepted",
      OR: [
        { requesterId: aId, addresseeId: bId },
        { requesterId: bId, addresseeId: aId },
      ],
    },
  });
  return count > 0;
}

export async function sendRequest(
  meId: string,
  targetId: string,
): Promise<Friendship> {
  if (meId === targetId) throw new Error("You cannot friend yourself.");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.friendship.findFirst({
      where: {
        OR: [
          { requesterId: meId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: meId },
        ],
      },
    });

    if (!existing) {
      return tx.friendship.create({
        data: { requesterId: meId, addresseeId: targetId, status: "pending" },
      });
    }

    if (existing.status === "accepted") return existing;

    if (existing.requesterId === targetId && existing.addresseeId === meId) {
      return tx.friendship.update({
        where: {
          requesterId_addresseeId: { requesterId: targetId, addresseeId: meId },
        },
        data: { status: "accepted", respondedAt: new Date() },
      });
    }

    return existing;
  });
}

export async function acceptRequest(
  meId: string,
  requesterId: string,
): Promise<Friendship> {
  const res = await prisma.friendship.updateMany({
    where: { requesterId, addresseeId: meId, status: "pending" },
    data: { status: "accepted", respondedAt: new Date() },
  });
  if (res.count === 0) throw new Error("Friend request not found.");
  const friendship = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId, addresseeId: meId } },
  });
  if (!friendship) throw new Error("Friend request not found.");
  return friendship;
}

export async function declineRequest(
  meId: string,
  requesterId: string,
): Promise<void> {
  await prisma.friendship.deleteMany({
    where: { requesterId, addresseeId: meId, status: "pending" },
  });
}

export async function cancelRequest(
  meId: string,
  targetId: string,
): Promise<void> {
  await prisma.friendship.deleteMany({
    where: { requesterId: meId, addresseeId: targetId, status: "pending" },
  });
}

export async function removeFriend(aId: string, bId: string): Promise<void> {
  await prisma.friendship.deleteMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: aId, addresseeId: bId },
        { requesterId: bId, addresseeId: aId },
      ],
    },
  });
}

export async function listFriends(profileId: string): Promise<Profile[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: profileId }, { addresseeId: profileId }],
    },
    include: { requester: true, addressee: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) =>
    row.requesterId === profileId ? row.addressee : row.requester,
  );
}

export async function countFriends(profileId: string): Promise<number> {
  return prisma.friendship.count({
    where: {
      status: "accepted",
      OR: [{ requesterId: profileId }, { addresseeId: profileId }],
    },
  });
}

export function listIncomingRequests(
  meId: string,
): Promise<FriendshipWithRequester[]> {
  return prisma.friendship.findMany({
    where: { addresseeId: meId, status: "pending" },
    include: { requester: true },
    orderBy: { createdAt: "desc" },
  });
}

export function listOutgoingRequests(
  meId: string,
): Promise<FriendshipWithAddressee[]> {
  return prisma.friendship.findMany({
    where: { requesterId: meId, status: "pending" },
    include: { addressee: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function friendStateFor(
  viewerId: string | null,
  profileId: string,
): Promise<FriendState> {
  if (!viewerId) return "none";
  if (viewerId === profileId) return "self";

  const rows = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: profileId },
        { requesterId: profileId, addresseeId: viewerId },
      ],
    },
  });

  if (rows.some((row) => row.status === "accepted")) return "friends";
  if (
    rows.some(
      (row) =>
        row.status === "pending" &&
        row.requesterId === viewerId &&
        row.addresseeId === profileId,
    )
  ) {
    return "outgoing";
  }
  if (
    rows.some(
      (row) =>
        row.status === "pending" &&
        row.requesterId === profileId &&
        row.addresseeId === viewerId,
    )
  ) {
    return "incoming";
  }
  return "none";
}

export async function searchPilots(
  viewerId: string,
  query: string,
  limit = 8,
): Promise<SearchPilotResult[]> {
  const trimmed = query.trim();
  const normalized = trimmed.startsWith("@") ? trimmed.slice(1).trimStart() : trimmed;
  const take = Math.max(0, Math.floor(limit));
  if (normalized.length < 2 || take === 0) return [];

  // `contains` is currently an unindexed ILIKE scan. That is fine for the
  // current user base; a trigram index is the likely future optimization.
  const prefixMatches = await prisma.profile.findMany({
    where: {
      id: { not: viewerId },
      OR: [
        { handle: { startsWith: normalized, mode: "insensitive" } },
        { displayName: { startsWith: normalized, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUpdatedAt: true,
    },
    orderBy: { handle: "asc" },
    take,
  });

  const substringMatches =
    prefixMatches.length >= take
      ? []
      : await prisma.profile.findMany({
          where: {
            id: { notIn: [viewerId, ...prefixMatches.map((profile) => profile.id)] },
            OR: [
              { handle: { contains: normalized, mode: "insensitive" } },
              { displayName: { contains: normalized, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUpdatedAt: true,
          },
          orderBy: { handle: "asc" },
          take: take - prefixMatches.length,
        });

  const profiles = [...prefixMatches, ...substringMatches];

  const ids = profiles.map((profile) => profile.id);
  const rows =
    ids.length === 0
      ? []
      : await prisma.friendship.findMany({
          where: {
            OR: [
              { requesterId: viewerId, addresseeId: { in: ids } },
              { requesterId: { in: ids }, addresseeId: viewerId },
            ],
          },
        });

  const states = new Map<string, SearchPilotState>();
  for (const row of rows) {
    const profileId = row.requesterId === viewerId ? row.addresseeId : row.requesterId;
    if (row.status === "accepted") {
      states.set(profileId, "friends");
    } else if (states.get(profileId) !== "friends") {
      states.set(profileId, row.requesterId === viewerId ? "outgoing" : "incoming");
    }
  }

  const needle = normalized.toLowerCase();
  return profiles
    .map((profile) => ({
      ...profile,
      state: states.get(profile.id) ?? "none",
    }))
    .sort((a, b) => {
      const aHandle = a.handle.toLowerCase().startsWith(needle);
      const bHandle = b.handle.toLowerCase().startsWith(needle);
      if (aHandle !== bHandle) return aHandle ? -1 : 1;

      const aDisplay = a.displayName.toLowerCase().startsWith(needle);
      const bDisplay = b.displayName.toLowerCase().startsWith(needle);
      if (aDisplay !== bDisplay) return aDisplay ? -1 : 1;

      return a.handle.localeCompare(b.handle);
    });
}
