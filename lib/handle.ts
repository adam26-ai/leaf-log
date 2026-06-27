/** Shared handle rules — used by onboarding and profile settings. */

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

const RESERVED = new Set([
  "sign-in", "signin", "onboarding", "logbook", "upload", "settings", "auth",
  "api", "flights", "flight", "admin", "about", "help", "support", "leaf",
  "leaflog", "profile", "profiles", "me", "new", "public", "static", "_next",
]);

/**
 * Validate + normalize a handle. Returns the lowercased handle on success, or an
 * `error` message suitable for surfacing to the user.
 */
export function normalizeHandle(
  raw: string,
): { handle: string } | { error: string } {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return {
      error:
        "Handle must be 3–20 characters: lowercase letters, numbers, or underscores.",
    };
  }
  if (RESERVED.has(handle)) {
    return { error: "That handle is reserved — please choose another." };
  }
  return { handle };
}

/** Validate a display name; returns the trimmed value or an error message. */
export function normalizeDisplayName(
  raw: string,
): { displayName: string } | { error: string } {
  const displayName = raw.trim();
  if (displayName.length < 1 || displayName.length > 60) {
    return { error: "Please enter a display name (up to 60 characters)." };
  }
  return { displayName };
}
