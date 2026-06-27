import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Edge-safe NextAuth instance (no Prisma adapter) just for reading the session.
const { auth } = NextAuth(authConfig);

// Routes requiring a signed-in pilot. Public flight pages (/flights/[id]) and
// public profiles (/@handle) stay open — visibility is decided server-side.
const PROTECTED = ["/upload", "/logbook", "/onboarding", "/settings"];

// Next 16: the `middleware` file convention is renamed to `proxy`.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  // A signed-in pilot has no use for the marketing landing — send them straight
  // to their logbook. (Anonymous visitors still get the static landing page.)
  if (pathname === "/" && req.auth) {
    return NextResponse.redirect(new URL("/logbook", req.nextUrl));
  }
  if (PROTECTED.some((p) => pathname.startsWith(p)) && !req.auth) {
    const url = new URL("/sign-in", req.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
