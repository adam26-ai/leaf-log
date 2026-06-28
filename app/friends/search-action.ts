"use server";

import { getCurrentUserId } from "@/lib/profile";
import { searchPilots } from "@/lib/social/friends";

export async function searchPilotsAction(query: string) {
  const viewerId = await getCurrentUserId();
  if (!viewerId) return [];
  return searchPilots(viewerId, query);
}
