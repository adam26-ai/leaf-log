"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Toggle a flight's visibility. RLS guarantees a pilot can only update their own
 * flight, so no extra ownership check is needed beyond an authenticated session.
 */
export async function setVisibility(
  flightId: string,
  visibility: "private" | "public",
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("flights")
    .update({ visibility })
    .eq("id", flightId)
    .eq("owner_id", user.id);

  if (error) return { ok: false };
  revalidatePath(`/flights/${flightId}`);
  revalidatePath("/logbook");
  return { ok: true };
}
