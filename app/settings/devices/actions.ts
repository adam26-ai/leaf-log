"use server";

import { revalidatePath } from "next/cache";
import { claimPairing } from "@/lib/devices/pairing-repo";
import { revokeDeviceToken } from "@/lib/devices/repo";
import { requireProfile } from "@/lib/profile";

export type ClaimDeviceActionState = { error?: string; ok?: boolean };
export type RevokeDeviceKeyState = { error?: string; ok?: boolean };

const MAX_LABEL = 60;

export async function claimDeviceAction(
  code: string,
  label?: string,
): Promise<ClaimDeviceActionState> {
  const profile = await requireProfile();
  const cleanCode = code.trim();
  const cleanLabel = label?.trim() || undefined;

  if (!cleanCode) return { error: "Enter the pairing code shown on your Leaf." };
  if (cleanLabel && cleanLabel.length > MAX_LABEL) {
    return { error: `Device name must be ${MAX_LABEL} characters or fewer.` };
  }

  const result = await claimPairing(profile.id, cleanCode, cleanLabel);
  if (!result.ok) {
    return { error: "That pairing code is invalid or expired." };
  }

  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function revokeDeviceKeyAction(
  id: string,
): Promise<RevokeDeviceKeyState> {
  const profile = await requireProfile();
  const revoked = await revokeDeviceToken(id, profile.id);
  revalidatePath("/settings/devices");
  return revoked ? { ok: true } : { error: "Device key not found." };
}
