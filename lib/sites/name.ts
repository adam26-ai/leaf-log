/**
 * Site name validation and normalization. Pure — no DB/Next imports.
 *
 * No global uniqueness: real gazetteers have many "Le Col", and a global
 * unique name would let the first creator squat a common one. Uniqueness is
 * proximity-scoped instead (checked by the caller against visible sites
 * within the advisory radius) — this module only validates and normalizes.
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 60;

// Case-insensitive; checked against the folded (lowercased) name.
const RESERVED_NAMES = new Set([
  "unknown site",
  "unknown",
  "unnamed",
  "none",
  "null",
  "n/a",
]);

// Control chars (C0: U+0000-U+001F, C1: U+007F-U+009F), zero-width chars
// (U+200B-U+200F), and bidi control chars (U+202A-U+202E, U+2066-U+2069) —
// the homograph vector for a name every pilot reads. Built from \u escapes
// (never pasted as literal characters) so the pattern can't be silently
// corrupted by the very kind of invisible character it exists to strip.
const STRIP_PATTERN = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g",
);

// Letters of any script (\p{L}), digits (\p{N}), spaces, and ' - – ( ) . , / &
const ALLOWED_CHARS_PATTERN = /^[\p{L}\p{N} '\-–(),./&]*$/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export type NameValidationError =
  | "too_short"
  | "too_long"
  | "no_letter_or_digit"
  | "invalid_characters"
  | "reserved";

export type NameValidationResult =
  | { ok: true; name: string; normalizedName: string }
  | { ok: false; error: NameValidationError };

/** NFKC → strip control/zero-width/bidi → trim → collapse internal whitespace. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(STRIP_PATTERN, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** The folded form used for proximity-scoped duplicate checks. */
export function foldName(name: string): string {
  return name.toLowerCase();
}

export function validateSiteName(raw: string): NameValidationResult {
  const name = normalizeName(raw);

  if (name.length < NAME_MIN_LENGTH) return { ok: false, error: "too_short" };
  if (name.length > NAME_MAX_LENGTH) return { ok: false, error: "too_long" };
  if (!HAS_LETTER_OR_DIGIT.test(name)) return { ok: false, error: "no_letter_or_digit" };
  if (!ALLOWED_CHARS_PATTERN.test(name)) return { ok: false, error: "invalid_characters" };

  const normalizedName = foldName(name);
  if (RESERVED_NAMES.has(normalizedName)) return { ok: false, error: "reserved" };

  return { ok: true, name, normalizedName };
}
