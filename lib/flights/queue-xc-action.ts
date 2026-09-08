"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";

export async function queueFlightXc(flightId: string): Promise<{ error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return { error: "Please sign in." };
  // Conditional update is idempotent: repeated clicks cannot duplicate jobs.
  const result = await prisma.flight.updateMany({
    where: { id: flightId, ownerId, status: "ready", xcStatus: { in: ["unscored", "failed"] } },
    data: { xcStatus: "queued", xcQueuedAt: new Date(), xcError: null },
  });
  if (!result.count) {
    const flight = await prisma.flight.findFirst({ where: { id: flightId, ownerId }, select: { xcStatus: true } });
    if (!flight || !["queued", "ready"].includes(flight.xcStatus)) return { error: "This flight cannot be scored." };
  }
  revalidatePath("/logbook");
  revalidatePath(`/flights/${flightId}`);
  return {};
}
