"use server";

import { getCurrentProfile } from "@/lib/profile";
import { navigationCounts } from "@/lib/social/notifications";

export async function getNavigationCounts(seenThrough?: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { feed: 0, friends: 0 };
  const parsed = seenThrough ? new Date(seenThrough) : undefined;
  const safeDate = parsed && Number.isFinite(parsed.getTime())
    ? new Date(Math.min(parsed.getTime(), Date.now())) : undefined;
  return navigationCounts(profile.id, safeDate);
}
