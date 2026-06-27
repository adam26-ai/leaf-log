import { NextResponse } from "next/server";
import { getAvatarBytes } from "@/lib/avatar/repo";

export const runtime = "nodejs";

/**
 * Serve a pilot's avatar by handle (public — profiles are public; the bytes are
 * sanitized JPEG with no EXIF). `?variant=thumb` for the small square; default
 * is the full 512px. Callers append `?v=<avatarUpdatedAt>` to bust the cache.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const variant =
    new URL(request.url).searchParams.get("variant") === "thumb" ? "thumb" : "full";

  const bytes = await getAvatarBytes(handle, variant);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      // Public + immutable per cache-busting key; safe to cache hard.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
