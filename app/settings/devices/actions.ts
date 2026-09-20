"use server";

import { revalidatePath } from "next/cache";
import { claimPairing } from "@/lib/devices/pairing-repo";
import { deleteRevokedDeviceToken, restoreDeviceToken, revokeDeviceToken } from "@/lib/devices/repo";
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

  revalidatePath("/settings");
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function revokeDeviceKeyAction(
  id: string,
): Promise<RevokeDeviceKeyState> {
  const profile = await requireProfile();
  const revoked = await revokeDeviceToken(id, profile.id);
  revalidatePath("/settings");
  revalidatePath("/settings/devices");
  return revoked ? { ok: true } : { error: "Device key not found." };
}

export async function deleteRevokedDeviceKeyAction(
  id: string,
): Promise<RevokeDeviceKeyState> {
  const profile = await requireProfile();
  const deleted = await deleteRevokedDeviceToken(id, profile.id);
  revalidatePath("/settings");
  revalidatePath("/settings/devices");
  return deleted ? { ok: true } : { error: "Revoked device not found." };
}

export async function restoreDeviceKeyAction(
  id: string,
): Promise<RevokeDeviceKeyState> {
  const profile = await requireProfile();
  const restored = await restoreDeviceToken(id, profile.id);
  revalidatePath("/settings");
  revalidatePath("/settings/devices");
  return restored ? { ok: true } : { error: "Revoked device not found." };
}
