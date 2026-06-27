"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { normalizeHandle, normalizeDisplayName } from "@/lib/handle";

export type SettingsState = { error?: string; ok?: boolean };

const MAX_BIO = 280;

/** Update the signed-in pilot's profile (handle, display name, bio, default privacy). */
export async function updateProfile(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Not signed in." };

  const h = normalizeHandle(String(formData.get("handle") ?? ""));
  if ("error" in h) return { error: h.error };
  const d = normalizeDisplayName(String(formData.get("display_name") ?? ""));
  if ("error" in d) return { error: d.error };

  const bio = String(formData.get("bio") ?? "").trim();
  if (bio.length > MAX_BIO) {
    return { error: `Bio must be ${MAX_BIO} characters or fewer.` };
  }

  const defaultVisibility =
    String(formData.get("default_visibility") ?? "") === "public"
      ? "public"
      : "private";

  // Reject changing the handle to one another pilot already owns (the unique
  // constraint catches the race; this gives a friendlier message first).
  const existing = await prisma.profile.findUnique({
    where: { handle: h.handle },
    select: { id: true },
  });
  if (existing && existing.id !== userId) {
    return { error: "That handle is already taken — try another." };
  }

  try {
    await prisma.profile.update({
      where: { id: userId },
      data: {
        handle: h.handle,
        displayName: d.displayName,
        bio: bio || null,
        defaultVisibility,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That handle is already taken — try another." };
    }
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath("/settings");
  revalidatePath(`/@${h.handle}`);
  return { ok: true };
}
