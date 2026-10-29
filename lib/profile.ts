import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@prisma/client";
import { cache } from "react";

export type { Profile };

/** The authenticated user id (== Profile id), or null. */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.id ?? null;
});

/** The current pilot's profile, or null if signed out / not yet onboarded. */
// Deduplicate layout/header/page reads within this server render only. Never
// share authentication or profiles between requests or users.
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const id = await getCurrentUserId();
  if (!id) return null;
  return prisma.profile.findUnique({ where: { id } });
});

/**
 * For protected pages: ensure the pilot is signed in AND onboarded.
 * Redirects to /sign-in or /onboarding as needed; otherwise returns the profile.
 */
export async function requireProfile(): Promise<Profile> {
  const id = await getCurrentUserId();
  if (!id) redirect("/sign-in");
  const profile = await getCurrentProfile();
  if (!profile) redirect("/onboarding");
  return profile;
}

/**
 * A profile's ordinary display facts (handle/name/avatar) — the same
 * non-sensitive shape already surfaced in feeds and search, not gated on
 * any relationship to the viewer. Used to resolve a flight's currently- or
 * formerly-assigned instructor, who may not be in the viewer's friend list.
 */
export async function getProfileById(id: string): Promise<{
  id: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | null;
} | null> {
  return prisma.profile.findUnique({
    where: { id },
    select: { id: true, handle: true, displayName: true, avatarUpdatedAt: true },
  });
}
