import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@prisma/client";

export type { Profile };

/** The authenticated user id (== Profile id), or null. */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** The current pilot's profile, or null if signed out / not yet onboarded. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const id = await getCurrentUserId();
  if (!id) return null;
  return prisma.profile.findUnique({ where: { id } });
}

/**
 * For protected pages: ensure the pilot is signed in AND onboarded.
 * Redirects to /sign-in or /onboarding as needed; otherwise returns the profile.
 */
export async function requireProfile(): Promise<Profile> {
  const id = await getCurrentUserId();
  if (!id) redirect("/sign-in");
  const profile = await prisma.profile.findUnique({ where: { id } });
  if (!profile) redirect("/onboarding");
  return profile;
}
