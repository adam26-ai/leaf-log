import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { logbookCompanions } from "@/lib/flights/repo";

export const runtime = "nodejs";
export async function GET() {
  const viewerId = await getCurrentUserId();
  const headers = { "cache-control": "no-store" };
  if (!viewerId) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers });
  return NextResponse.json({ friends: await logbookCompanions(viewerId) }, { headers });
}
