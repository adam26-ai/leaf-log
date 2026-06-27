"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { normalizeHandle, normalizeDisplayName } from "@/lib/handle";

export type OnboardingState = { error?: string };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const h = normalizeHandle(String(formData.get("handle") ?? ""));
  if ("error" in h) return { error: h.error };
  const d = normalizeDisplayName(String(formData.get("display_name") ?? ""));
  if ("error" in d) return { error: d.error };
  const { handle } = h;
  const { displayName } = d;

  const userId = await getCurrentUserId();
  if (!userId) redirect("/sign-in");

  try {
    await prisma.profile.create({
      data: { id: userId, handle, displayName },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That handle is already taken — try another." };
    }
    return { error: "Something went wrong. Please try again." };
  }

  redirect("/logbook");
}
