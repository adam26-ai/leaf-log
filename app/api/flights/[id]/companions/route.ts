import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { listReplayCompanions } from "@/lib/flights/repo";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cursor = new URL(request.url).searchParams.get("cursor") ?? "0";
  const headers = { "cache-control": "no-store" };
  if (!/^\d{1,6}$/.test(cursor)) return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers });
  const result = await listReplayCompanions(id, await getCurrentUserId(), Number(cursor));
  return result ? NextResponse.json(result, { headers }) : NextResponse.json({ error: "Not found" }, { status: 404, headers });
}
