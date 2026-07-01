import { NextResponse } from "next/server";
import { startPairing } from "@/lib/devices/pairing-repo";

export const runtime = "nodejs";

/**
 * Public device endpoint. Add a small per-IP rate limiter here before exposing
 * this beyond trusted reverse-proxy traffic.
 */
export async function POST() {
  try {
    const pairing = await startPairing();
    return NextResponse.json({
      code: pairing.code,
      pollHandle: pairing.pollHandle,
      expiresAt: pairing.expiresAt.toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not start pairing" },
      { status: 500 },
    );
  }
}
