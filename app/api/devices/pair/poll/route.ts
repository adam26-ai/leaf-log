import { NextResponse } from "next/server";
import { pollPairing } from "@/lib/devices/pairing-repo";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const pollHandle =
    body && typeof body === "object" && "pollHandle" in body
      ? (body as { pollHandle?: unknown }).pollHandle
      : undefined;
  if (typeof pollHandle !== "string" || !pollHandle.trim()) {
    return NextResponse.json({ error: "Missing poll handle" }, { status: 400 });
  }

  const result = await pollPairing(pollHandle);
  return NextResponse.json(result);
}
