"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getCurrentUserId } from "@/lib/profile";
import { renameOwnWings, wingEditSchema, WingListChanged } from "@/lib/flights/wings";

export async function saveWingNames(input: unknown): Promise<{ count?: number; error?: string; stale?: boolean }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return { error: "Please sign in to edit your wings." };
  const parsed = wingEditSchema.safeParse(input);
  if (!parsed.success) return { error: "Select at least one wing and enter a name of 1–200 characters on one line." };
  try {
    const count = await renameOwnWings(ownerId, parsed.data);
    revalidatePath("/", "layout");
    return { count };
  } catch (error) {
    if (error instanceof WingListChanged || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) {
      revalidatePath("/settings");
      return { error: "Your wing list changed. Review the refreshed list and select the wings again.", stale: true };
    }
    return { error: "Couldn't save the wing names. Please try again." };
  }
}

export async function setWingVisibility(name: string, hidden: boolean): Promise<{ error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return { error: "Please sign in to edit your wings." };
  if (typeof name !== "string" || typeof hidden !== "boolean" || !await prisma.flight.count({ where: { ownerId, glider: name } })) return { error: "Wing not found." };
  if (hidden) {
    await prisma.profile.updateMany({ where: { id: ownerId, NOT: { hiddenWings: { has: name } } }, data: { hiddenWings: { push: name } } });
  } else {
    await prisma.$executeRaw`UPDATE "Profile" SET "hiddenWings" = array_remove("hiddenWings", ${name}), "updatedAt" = NOW() WHERE "id" = ${ownerId}`;
  }
  revalidatePath("/", "layout");
  return {};
}
