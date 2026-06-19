"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";

/**
 * Delete a flight. Owner-scoped via the where-clause — a pilot can only ever
 * delete their own flight. FlightData cascades. Redirects to the logbook.
 */
export async function deleteFlight(flightId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/sign-in");

  await prisma.flight.deleteMany({ where: { id: flightId, ownerId: userId } });

  revalidatePath("/logbook");
  redirect("/logbook");
}
