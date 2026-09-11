import type { Flight } from "@prisma/client";

/** Stable, unique archive names also used by individual IGC downloads. */
export function igcFilename(flight: Pick<Flight, "id" | "takeoffAt" | "flightDate" | "localUtcOffsetMinutes">) {
  const date = flight.takeoffAt
    ? new Date(flight.takeoffAt.getTime() + (flight.localUtcOffsetMinutes ?? 0) * 60_000)
    : flight.flightDate;
  const id = flight.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `flight-${date ? `${date.toISOString().slice(0, 10)}-` : ""}${id}.igc`;
}
