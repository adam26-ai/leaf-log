import { prisma } from "@/lib/prisma";
import { getFlightForViewer } from "./repo";
import { igcFilename } from "./igc-filename";

/** Original recorder data is downloadable by its owner, independent of analysis status. */
export async function getOriginalIgcForOwner(flightId: string, ownerId: string | null) {
  if (!ownerId) return null;
  const flight = await getFlightForViewer(flightId, ownerId);
  if (!flight || flight.ownerId !== ownerId) return null;
  const data = await prisma.flightData.findFirst({
    where: { flightId: flight.id, flight: { ownerId } },
    select: { rawIgc: true },
  });
  if (!data) return null;

  return { bytes: data.rawIgc, filename: igcFilename(flight) };
}
