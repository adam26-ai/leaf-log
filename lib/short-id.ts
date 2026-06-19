// Short ids for URL-visible entities. 4 chars over [a-z0-9] → 36^4 ≈ 1.68M space,
// so collisions are effectively nil at this app's scale (and retried anyway).

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const SHORT_ID_LENGTH = 4;
export const SHORT_ID_MAX_RETRY = 5;

/** A fresh 4-char `[a-z0-9]` id. */
export function generateShortId(length = SHORT_ID_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Detect a Prisma P2002 unique-constraint violation on the `id` / primary key.
 * Arrays use EXACT element membership (so a `[ownerId, igcSha256]` dedup
 * violation is NOT mistaken for an id collision — `"ownerId"` contains the
 * substring "id" but isn't the element `"id"`).
 */
export function isP2002OnId(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes("id");
  if (typeof target === "string") {
    const t = target.toLowerCase();
    return t === "id" || t.includes("pkey");
  }
  return false;
}

/**
 * Wrap a `create` call: inject a fresh short id when the caller didn't supply one,
 * retrying on an id collision up to SHORT_ID_MAX_RETRY times. A caller-supplied
 * `id` always wins (no generation, no retry).
 */
export async function createWithShortIdRetry<
  TArgs extends { data: { id?: string } },
  TResult,
>(args: TArgs, query: (args: TArgs) => Promise<TResult>): Promise<TResult> {
  if (args.data?.id) return query(args);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < SHORT_ID_MAX_RETRY; attempt++) {
    args.data.id = generateShortId();
    try {
      return await query(args);
    } catch (err) {
      lastErr = err;
      if (!isP2002OnId(err)) throw err;
    }
  }
  throw new Error(
    `Failed to generate a unique short id after ${SHORT_ID_MAX_RETRY} attempts`,
    { cause: lastErr },
  );
}
