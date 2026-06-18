"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  const handleRaw = String(formData.get("handle") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!HANDLE_RE.test(handleRaw)) {
    return {
      error:
        "Handle must be 3–20 characters: lowercase letters, numbers, or underscores.",
    };
  }
  if (RESERVED.has(handleRaw)) {
    return { error: "That handle is reserved — please choose another." };
  }
  if (displayName.length < 1 || displayName.length > 60) {
    return { error: "Please enter a display name (up to 60 characters)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    handle: handleRaw,
    display_name: displayName,
  });

  if (error) {
    // 23505 = unique_violation (handle already taken)
    if (error.code === "23505") {
      return { error: "That handle is already taken — try another." };
    }
    return { error: "Something went wrong. Please try again." };
  }

  redirect("/logbook");
}
