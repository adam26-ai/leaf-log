import { getCurrentUserId } from "@/lib/profile";
import { listOwnFlightsForExport } from "@/lib/flights/repo";
import { csvExportStream, igcZipStream } from "@/lib/logbook/export";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  const ownerId = await getCurrentUserId();
  if (!ownerId) return Response.json({ error: "Sign in to export your logbook." }, { status: 401, headers });
  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "igc") return Response.json({ error: "Choose CSV or IGC ZIP." }, { status: 400, headers });

  const flights = await listOwnFlightsForExport(ownerId);
  const csv = format === "csv";
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv ? csvExportStream(ownerId, flights, request.signal) : igcZipStream(ownerId, flights, request.signal), {
    headers: {
      ...headers,
      "content-type": csv ? "text/csv; charset=utf-8" : "application/zip",
      "content-disposition": `attachment; filename="leaf-log-${csv ? "logbook" : "igc"}-${date}.${csv ? "csv" : "zip"}"`,
    },
  });
}
