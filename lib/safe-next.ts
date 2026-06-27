/**
 * Sanitize a post-auth redirect target to an app-internal path. Rejects external
 * URLs, protocol-relative (`//host`), and the auth/interstitial routes themselves
 * (to avoid loops). Returns the fallback for anything that isn't a clean
 * same-origin path.
 */
export function safeNext(
  next: string | null | undefined,
  fallback = "/onboarding",
): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  const path = next.split(/[?#]/)[0];
  if (path === "/sign-in" || path === "/check-email" || path === "/stay-signed-in") {
    return fallback;
  }
  return next;
}
