"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import {
  FLIGHT_VISIBILITIES,
  normalizeVisibility,
  type FlightVisibility,
} from "@/lib/flights/visibility";

/**
 * Toggle a flight's visibility. Scoped to the owner via the where-clause — a
 * pilot can only ever update their own flight.
 */
export async function setVisibility(
  flightId: string,
  visibility: FlightVisibility,
): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };
  if (!(FLIGHT_VISIBILITIES as readonly string[]).includes(visibility)) {
    return { ok: false };
  }

  const nextVisibility = normalizeVisibility(visibility);

  const res = await prisma.flight.updateMany({
    where: { id: flightId, ownerId: userId },
    data: { visibility: nextVisibility },
  });
  if (res.count === 0) return { ok: false };

  revalidatePath(`/flights/${flightId}`);
  revalidatePath("/logbook");
  return { ok: true };
}
