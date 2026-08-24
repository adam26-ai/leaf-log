/**
 * SPRINT-007: the contributor roster, derived from the audit log rather
 * than a separately maintained table — always consistent by construction,
 * no dual-write drift risk. `GROUP BY actorId` over LocationAuditEntry
 * (non-null actors only — a deleted profile's entries survive via
 * actorId: SetNull, but drop out of the roster, matching decision in
 * docs/sprints/SPRINT-007.md's Security section).
 */
import { prisma } from "@/lib/prisma";

export interface Contributor {
  profileId: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | null;
  firstContributedAt: Date;
  lastContributedAt: Date;
  actionCount: number;
}

interface ContributorRow {
  actorId: string | null;
  _min: { createdAt: Date | null };
  _max: { createdAt: Date | null };
  _count: { _all: number };
}

async function contributorsFor(where: { siteId: string } | { zoneId: string }): Promise<Contributor[]> {
  const grouped = await prisma.locationAuditEntry.groupBy({
    by: ["actorId"],
    where: { ...where, actorId: { not: null } },
    _min: { createdAt: true },
    _max: { createdAt: true },
    _count: { _all: true },
  });

  const rows = grouped as ContributorRow[];
  if (rows.length === 0) return [];

  const profileIds = rows.map((r) => r.actorId).filter((id): id is string => id !== null);
  const profiles = await prisma.profile.findMany({
    where: { id: { in: profileIds } },
    select: { id: true, handle: true, displayName: true, avatarUpdatedAt: true },
  });
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const contributors: Contributor[] = [];
  for (const row of rows) {
    if (row.actorId === null) continue;
    const profile = profileById.get(row.actorId);
    if (!profile) continue; // deleted profile — drops out of the roster, audit entry itself survives
    contributors.push({
      profileId: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUpdatedAt: profile.avatarUpdatedAt,
      firstContributedAt: row._min.createdAt as Date,
      lastContributedAt: row._max.createdAt as Date,
      actionCount: row._count._all,
    });
  }

  return contributors.sort((a, b) => a.firstContributedAt.getTime() - b.firstContributedAt.getTime());
}

export function contributorsForSite(siteId: string): Promise<Contributor[]> {
  return contributorsFor({ siteId });
}

export function contributorsForZone(zoneId: string): Promise<Contributor[]> {
  return contributorsFor({ zoneId });
}
