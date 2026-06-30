"use server";

import { revalidatePath } from "next/cache";
import { createDeviceToken, revokeDeviceToken } from "@/lib/devices/repo";
import { requireProfile } from "@/lib/profile";

export type DeviceKeyActionState = { error?: string; plaintext?: string };
export type RevokeDeviceKeyState = { error?: string; ok?: boolean };

const MAX_LABEL = 60;
const MAX_DEVICE_ID = 120;

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export async function generateDeviceKeyAction(
  label: string,
  deviceId?: string,
): Promise<DeviceKeyActionState> {
  const profile = await requireProfile();
  const cleanLabel = label.trim();
  const cleanDeviceId = cleanOptional(deviceId);

  if (!cleanLabel) return { error: "Give this device a name." };
  if (cleanLabel.length > MAX_LABEL) {
    return { error: `Device name must be ${MAX_LABEL} characters or fewer.` };
  }
  if (cleanDeviceId && cleanDeviceId.length > MAX_DEVICE_ID) {
    return { error: `Device ID must be ${MAX_DEVICE_ID} characters or fewer.` };
  }

  const { plaintext } = await createDeviceToken(
    profile.id,
    cleanLabel,
    cleanDeviceId,
  );
  revalidatePath("/settings/devices");
  revalidatePath("/pair");
  return { plaintext };
}

export async function revokeDeviceKeyAction(
  id: string,
): Promise<RevokeDeviceKeyState> {
  const profile = await requireProfile();
  const revoked = await revokeDeviceToken(id, profile.id);
  revalidatePath("/settings/devices");
  revalidatePath("/pair");
  return revoked ? { ok: true } : { error: "Device key not found." };
}
