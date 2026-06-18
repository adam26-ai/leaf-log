import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";

export type Profile = Tables<"profiles">;

/** The authenticated auth.users row, or null. */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The current pilot's profile, or null if signed out / not yet onboarded. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data;
}

/**
 * For protected pages: ensure the pilot is signed in AND onboarded.
 * Redirects to /sign-in or /onboarding as needed; otherwise returns the profile.
 */
export async function requireProfile(): Promise<Profile> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const profile = await getCurrentProfile();
  if (!profile) redirect("/onboarding");
  return profile;
}
