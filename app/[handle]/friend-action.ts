"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  removeFriend,
  sendRequest,
} from "@/lib/social/friends";

export type FriendActionResult = { ok: true } | { error: string };

function normalizeProfileHandle(raw: string): string {
  const decoded = decodeURIComponent(raw.trim());
  return (decoded.startsWith("@") ? decoded.slice(1) : decoded).toLowerCase();
}

async function requireActor() {
  const id = await getCurrentUserId();
  if (!id) throw new Error("Not signed in.");
  const profile = await prisma.profile.findUnique({
    where: { id },
    select: { id: true, handle: true },
  });
  if (!profile) throw new Error("Profile not found.");
  return profile;
}

async function requireProfileByHandle(rawHandle: string) {
  const handle = normalizeProfileHandle(rawHandle);
  const profile = await prisma.profile.findUnique({
    where: { handle },
    select: { id: true, handle: true },
  });
  if (!profile) throw new Error("Profile not found.");
  return profile;
}

function revalidateFriendSurfaces(handles: string[]) {
  for (const handle of handles) revalidatePath(`/@${handle}`);
  revalidatePath("/friends");
}

export async function sendFriendRequest(
  targetHandle: string,
): Promise<FriendActionResult> {
  try {
    const [actor, target] = await Promise.all([
      requireActor(),
      requireProfileByHandle(targetHandle),
    ]);
    await sendRequest(actor.id, target.id);
    revalidateFriendSurfaces([actor.handle, target.handle]);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send request." };
  }
}

export async function acceptFriendRequest(
  requesterHandle: string,
): Promise<FriendActionResult> {
  try {
    const [actor, requester] = await Promise.all([
      requireActor(),
      requireProfileByHandle(requesterHandle),
    ]);
    await acceptRequest(actor.id, requester.id);
    revalidateFriendSurfaces([actor.handle, requester.handle]);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not accept request." };
  }
}

export async function declineFriendRequest(
  requesterHandle: string,
): Promise<FriendActionResult> {
  try {
    const [actor, requester] = await Promise.all([
      requireActor(),
      requireProfileByHandle(requesterHandle),
    ]);
    await declineRequest(actor.id, requester.id);
    revalidateFriendSurfaces([actor.handle, requester.handle]);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not decline request." };
  }
}

export async function cancelFriendRequest(
  targetHandle: string,
): Promise<FriendActionResult> {
  try {
    const [actor, target] = await Promise.all([
      requireActor(),
      requireProfileByHandle(targetHandle),
    ]);
    await cancelRequest(actor.id, target.id);
    revalidateFriendSurfaces([actor.handle, target.handle]);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not cancel request." };
  }
}

export async function removeFriendAction(
  targetHandle: string,
): Promise<FriendActionResult> {
  try {
    const [actor, target] = await Promise.all([
      requireActor(),
      requireProfileByHandle(targetHandle),
    ]);
    await removeFriend(actor.id, target.id);
    revalidateFriendSurfaces([actor.handle, target.handle]);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not remove friend." };
  }
}
