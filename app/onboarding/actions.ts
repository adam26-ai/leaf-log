"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";

const RESERVED = new Set([
  "sign-in", "signin", "onboarding", "logbook", "upload", "settings", "auth",
  "api", "flights", "flight", "admin", "about", "help", "support", "leaf",
  "leaflog", "profile", "me", "new", "public", "static", "_next",
]);

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export type OnboardingState = { error?: string };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!HANDLE_RE.test(handle)) {
    return {
      error:
        "Handle must be 3–20 characters: lowercase letters, numbers, or underscores.",
    };
  }
  if (RESERVED.has(handle)) {
    return { error: "That handle is reserved — please choose another." };
  }
  if (displayName.length < 1 || displayName.length > 60) {
    return { error: "Please enter a display name (up to 60 characters)." };
  }

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
