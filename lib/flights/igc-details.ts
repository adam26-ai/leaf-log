import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";

/** Owner-only suggestions; older imports did not persist the IGC pilot header. */
export async function getIgcDetailsOptions(ownerId: string, flightId: string) {
  const flights = await prisma.flight.findMany({
    where: { ownerId },
    select: { id: true, pilot: true, glider: true },
  });
  const legacy = await prisma.flightData.findMany({
    where: { flight: { ownerId, pilot: null } },
    select: { flightId: true, rawIgc: true },
  });
  const pilotsById = new Map(legacy.map(({ flightId, rawIgc }) => {
    // Only parse headers: no need to rebuild fixes or metrics for suggestions.
    const headers = new TextDecoder().decode(rawIgc).split(/\r?\n/)
      .filter((line) => line.startsWith("H")).join("\n");
    return [flightId, parseIgc(headers).headers.pilot] as const;
  }));
  const names = (values: (string | null | undefined)[]) =>
    [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))]
      .sort((a, b) => a.localeCompare(b));
  const current = flights.find((flight) => flight.id === flightId);
  return {
    pilot: current?.pilot ?? pilotsById.get(flightId) ?? "",
    pilots: names(flights.map((flight) => flight.pilot ?? pilotsById.get(flight.id))),
    gliders: names(flights.map((flight) => flight.glider)),
  };
}
