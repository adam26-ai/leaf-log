"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { analysisPending, analysisState, type AnalysisFlight } from "./analysis-state";

const select = { id: true, status: true, xcStatus: true, xcScore: true, metricsVersion: true, recordingKind: true } as const;
async function enqueue(ownerId: string, flight: AnalysisFlight & { id: string }) {
  const action = analysisState(flight).action;
  if (!action) return 0;
  const result = await prisma.flight.updateMany({
    where: { id: flight.id, ownerId, xcStatus: flight.xcStatus, metricsVersion: flight.metricsVersion },
    data: { xcStatus: action === "repair" ? "repair_queued" : action === "improve" ? "improve_queued" : "queued",
      xcQueuedAt: new Date(), xcStartedAt: null, xcError: null },
  });
  return result.count;
}
export async function queueFlightXc(flightId: string): Promise<{ error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return { error: "Please sign in." };
  const flight = await prisma.flight.findFirst({ where: { id: flightId, ownerId }, select });
  if (!flight) return { error: "This flight cannot be calculated." };
  if (analysisPending(flight.xcStatus)) return {};
  if (!analysisState(flight).action) return { error: "No calculation is needed for this flight." };
  await enqueue(ownerId, flight);
  revalidatePath("/logbook");
  revalidatePath(`/flights/${flightId}`);
  return {};
}
export async function queueMissingFlightAnalysis(kind: "xc" | "repair"): Promise<{ error?: string; count?: number }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return { error: "Please sign in." };
  if (kind !== "xc" && kind !== "repair") return { error: "Invalid calculation request." };
  const flights = await prisma.flight.findMany({ where: { ownerId }, select });
  let count = 0;
  for (const flight of flights) {
    const action = analysisState(flight).action;
    if (kind === "repair" ? action === "repair" : action && ["calculate", "retry", "complete"].includes(action)) {
      count += await enqueue(ownerId, flight);
    }
  }
  revalidatePath("/logbook");
  revalidatePath("/flights/[id]", "page");
  return { count };
}
