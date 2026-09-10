import { prisma } from "@/lib/prisma";
import { getFlightForViewer } from "./repo";

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

  const date = flight.takeoffAt
    ? new Date(flight.takeoffAt.getTime() + (flight.localUtcOffsetMinutes ?? 0) * 60_000)
    : flight.flightDate;
  const id = flight.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `flight-${date ? `${date.toISOString().slice(0, 10)}-` : ""}${id}.igc`;
  return { bytes: data.rawIgc, filename };
}
