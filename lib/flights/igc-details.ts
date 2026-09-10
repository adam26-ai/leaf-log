import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";

export interface RecordingDetails {
  originalAvailable: boolean;
  originalPilot: string | null;
  originalGlider: string | null;
  recorder: string | null;
  savedPilotLabel: string | null;
}

/** File metadata is independent of the profile that owns and flew the flight. */
export function recordingDetails(flight: { pilot: string | null; recorder: string | null; data: { rawIgc: Uint8Array } | null }): RecordingDetails {
  const originalAvailable = Boolean(flight.data?.rawIgc.length);
  // Inspect only this file's headers, not the GPS fixes or the pilot's other files.
  const text = flight.data ? new TextDecoder().decode(flight.data.rawIgc).split(/\r?\n/)
    .filter(line => line.startsWith("A") || line.startsWith("H")).join("\n") : "";
  const headers = parseIgc(text).headers;
  return {
    originalAvailable,
    originalPilot: headers.pilot,
    originalGlider: headers.glider,
    recorder: originalAvailable ? headers.recorder : flight.recorder,
    // Preserve old edits, including intentionally cleared labels. Never present them as file content.
    savedPilotLabel: flight.pilot === headers.pilot ? null : flight.pilot,
  };
}

/** Owner-only wing choices and read-only metadata for the flight being edited. */
export async function getIgcDetailsOptions(ownerId: string, flightId: string) {
  const [flights, current] = await Promise.all([
    prisma.flight.findMany({ where: { ownerId, glider: { not: null } }, select: { glider: true }, distinct: ["glider"] }),
    prisma.flight.findFirst({ where: { id: flightId, ownerId }, select: { pilot: true, recorder: true, data: { select: { rawIgc: true } } } }),
  ]);
  return {
    gliders: [...new Set(flights.map(flight => flight.glider?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    recording: current ? recordingDetails(current) : null,
  };
}
