/**
 * SPRINT-007: the append-only accountability log for PUBLIC Site/Zone
 * mutations. `writeAuditEntry` is a no-op for a PRIVATE target — a private
 * row's edit history is never recorded, so a later publish has nothing to
 * leak (decision 7 in docs/sprints/SPRINT-007.md). Called from inside the
 * caller's own transaction, mirroring lib/sites/boundary.ts's DB-free
 * design: this module's only DB touch is the one insert, everything else is
 * plain data shaping.
 */

import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "create"
  | "published"
  | "renamed"
  | "boundary_set"
  | "boundary_cleared"
  | "merge";

export interface AuditTarget {
  siteId?: string;
  zoneId?: string;
}

/** The narrow write-side slice this module needs — same structural-type
 *  reasoning as lib/sites/associate.ts's LocationCacheDb: the app's
 *  extended client's transaction type doesn't satisfy Prisma.TransactionClient
 *  directly, so this module never names that type. */
export interface AuditWriteDb {
  locationAuditEntry: {
    create(args: {
      data: {
        siteId?: string | null;
        zoneId?: string | null;
        actorId: string;
        action: AuditAction;
        detail?: Prisma.InputJsonValue;
      };
    }): Promise<unknown>;
  };
}

/**
 * Writes one entry inside the caller's own transaction — a no-op when
 * `visibility` is "private". Every mutation site passes its OWN
 * post-mutation visibility (not a cached value), so a simultaneous
 * visibility change and rename in one transaction is recorded correctly:
 * a rename applied to a row that just became private writes nothing; a
 * publish always writes exactly one `published` entry.
 */
export async function writeAuditEntry(
  tx: AuditWriteDb,
  target: AuditTarget,
  actorId: string,
  action: AuditAction,
  visibility: "public" | "private",
  detail?: Prisma.InputJsonValue,
): Promise<void> {
  if (visibility !== "public") return;
  await tx.locationAuditEntry.create({
    data: {
      siteId: target.siteId ?? null,
      zoneId: target.zoneId ?? null,
      actorId,
      action,
      detail,
    },
  });
}
