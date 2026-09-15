"use server";

import { signOut } from "@/lib/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

/** Leave an unfinished signup and return to a fresh email sign-in form. */
export async function switchEmailAction() {
  await signOut({ redirectTo: "/sign-in" });
}
