"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { changeSiteAdmin, searchAdminUsers } from "@/lib/admin";

export async function searchAdminUsersAction(query: string) {
  try {
    if (typeof query !== "string") throw new Error("Enter a search term.");
    return { ok: true as const, users: await searchAdminUsers(await getCurrentUserId(), query) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not search users." };
  }
}

export async function changeSiteAdminAction(userId: string, operation: "grant" | "revoke" | "delete") {
  try {
    if (typeof userId !== "string") throw new Error("Choose a user.");
    await changeSiteAdmin(await getCurrentUserId(), userId, operation);
    revalidatePath("/admin");
    revalidatePath("/sites");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update admin access." };
  }
}
