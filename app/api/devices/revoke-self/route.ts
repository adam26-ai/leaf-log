import { NextResponse } from "next/server";
import { revokeDeviceTokenByPlaintext } from "@/lib/devices/repo";
import { parseBearer } from "@/lib/devices/token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = parseBearer(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  try {
    const revoked = await revokeDeviceTokenByPlaintext(token);
    if (!revoked) {
      return NextResponse.json(
        { error: "Invalid or revoked key" },
        { status: 401 },
      );
    }
    return NextResponse.json({ revoked: true });
  } catch {
    return NextResponse.json(
      { error: "Could not revoke device key" },
      { status: 500 },
    );
  }
}
