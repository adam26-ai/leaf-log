import { prisma } from "@/lib/prisma";
import type { ProcessedAvatar } from "./process";

/**
 * The bytes for one avatar variant, looked up by public handle. Avatars are
 * public (profiles are public), so no viewer scoping — but a profile with no
 * uploaded avatar returns null (→ 404).
 */
export async function getAvatarBytes(
  handle: string,
  variant: "full" | "thumb",
): Promise<Buffer | null> {
  const profile = await prisma.profile.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      avatar: { select: { image: variant === "full", thumb: variant === "thumb" } },
    },
  });
  if (!profile?.avatar) return null;
  const bytes = variant === "full" ? profile.avatar.image : profile.avatar.thumb;
  return bytes ? Buffer.from(bytes) : null;
}

/** Upsert the avatar bytes and stamp the profile (cache-bust + "has avatar"). */
export async function setAvatar(
  profileId: string,
  processed: ProcessedAvatar,
  now: Date,
): Promise<void> {
  const image = new Uint8Array(processed.image);
  const thumb = new Uint8Array(processed.thumb);
  await prisma.$transaction([
    prisma.avatar.upsert({
      where: { profileId },
      create: { profileId, image, thumb },
      update: { image, thumb },
    }),
    prisma.profile.update({
      where: { id: profileId },
      data: { avatarUpdatedAt: now },
    }),
  ]);
}

/** Remove the avatar (no-op if none). Clears the profile's avatar stamp. */
export async function removeAvatar(profileId: string): Promise<void> {
  await prisma.$transaction([
    prisma.avatar.deleteMany({ where: { profileId } }),
    prisma.profile.update({
      where: { id: profileId },
      data: { avatarUpdatedAt: null },
    }),
  ]);
}
