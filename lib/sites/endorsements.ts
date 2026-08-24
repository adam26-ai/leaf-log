/**
 * SPRINT-007: one-tap, one-per-pilot-per-row endorsements for public
 * sites/zones — mirrors lib/social/kudos.ts's toggle/count shape exactly,
 * with two deliberate differences: no self-endorsement restriction
 * (decision 2 — a contributor endorsing their own row is normal, not
 * inflation; the composite PK is what prevents double-voting), and zone
 * gating uses EFFECTIVE visibility (zone AND parent site both public — the
 * same conjunction lib/sites/visibility.ts's canSeeZone uses elsewhere),
 * not the zone's own visibility column in isolation.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canSeeSite, canSeeZone, normalizeSiteVisibility } from "./visibility";

export interface EndorsementSummary {
  count: number;
  hasEndorsed: boolean;
}

function hiddenTargetError() {
  return new Error("Not found.");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function visiblePublicSite(siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, visibility: true, ownerId: true },
  });
  if (!site) return null;
  const visibility = normalizeSiteVisibility(site.visibility);
  if (visibility !== "public") return null;
  return site;
}

async function visiblePublicZone(zoneId: string) {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, visibility: true, ownerId: true, siteId: true },
  });
  if (!zone) return null;
  const site = await prisma.site.findUnique({
    where: { id: zone.siteId },
    select: { id: true, visibility: true, ownerId: true },
  });
  const zoneVisibility = normalizeSiteVisibility(zone.visibility);
  const siteVisibility = site ? normalizeSiteVisibility(site.visibility) : "private";
  const effectivelyPublic =
    zoneVisibility === "public" &&
    site !== null &&
    canSeeZone(
      { visibility: zoneVisibility, ownerId: zone.ownerId, siteId: zone.siteId },
      { id: site.id, visibility: siteVisibility, ownerId: site.ownerId },
      null,
    );
  if (!effectivelyPublic) return null;
  return zone;
}

export async function toggleSiteEndorsement(siteId: string, viewerId: string): Promise<{ endorsed: boolean }> {
  const site = await visiblePublicSite(siteId);
  if (!site) throw hiddenTargetError();

  const deleted = await prisma.siteEndorsement.deleteMany({ where: { siteId, profileId: viewerId } });
  if (deleted.count > 0) return { endorsed: false };

  try {
    await prisma.siteEndorsement.create({ data: { siteId, profileId: viewerId } });
    return { endorsed: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    await prisma.siteEndorsement.deleteMany({ where: { siteId, profileId: viewerId } });
    return { endorsed: false };
  }
}

export async function toggleZoneEndorsement(zoneId: string, viewerId: string): Promise<{ endorsed: boolean }> {
  const zone = await visiblePublicZone(zoneId);
  if (!zone) throw hiddenTargetError();

  const deleted = await prisma.zoneEndorsement.deleteMany({ where: { zoneId, profileId: viewerId } });
  if (deleted.count > 0) return { endorsed: false };

  try {
    await prisma.zoneEndorsement.create({ data: { zoneId, profileId: viewerId } });
    return { endorsed: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    await prisma.zoneEndorsement.deleteMany({ where: { zoneId, profileId: viewerId } });
    return { endorsed: false };
  }
}

/** Returns null for a private (or effectively-private, for a zone) target —
 *  matching the "no community info for a row a stranger can't see" rule.
 *  `viewerId: null` (anonymous) still returns a valid count, just with
 *  `hasEndorsed: false`. */
export async function siteEndorsementSummary(
  siteId: string,
  viewerId: string | null,
): Promise<EndorsementSummary | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, visibility: true, ownerId: true },
  });
  if (!site) return null;
  const visibility = normalizeSiteVisibility(site.visibility);
  if (!canSeeSite(visibility, site.ownerId, viewerId)) return null;

  const [count, own] = await Promise.all([
    prisma.siteEndorsement.count({ where: { siteId } }),
    viewerId
      ? prisma.siteEndorsement.findUnique({
          where: { siteId_profileId: { siteId, profileId: viewerId } },
          select: { siteId: true },
        })
      : null,
  ]);
  return { count, hasEndorsed: own !== null };
}

export async function zoneEndorsementSummary(
  zoneId: string,
  viewerId: string | null,
): Promise<EndorsementSummary | null> {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, visibility: true, ownerId: true, siteId: true },
  });
  if (!zone) return null;
  const site = await prisma.site.findUnique({
    where: { id: zone.siteId },
    select: { id: true, visibility: true, ownerId: true },
  });
  const visible = canSeeZone(
    { visibility: normalizeSiteVisibility(zone.visibility), ownerId: zone.ownerId, siteId: zone.siteId },
    site ? { id: site.id, visibility: normalizeSiteVisibility(site.visibility), ownerId: site.ownerId } : null,
    viewerId,
  );
  if (!visible) return null;

  const [count, own] = await Promise.all([
    prisma.zoneEndorsement.count({ where: { zoneId } }),
    viewerId
      ? prisma.zoneEndorsement.findUnique({
          where: { zoneId_profileId: { zoneId, profileId: viewerId } },
          select: { zoneId: true },
        })
      : null,
  ]);
  return { count, hasEndorsed: own !== null };
}

/** Batch counts for list/badge surfaces — callers must pass only ids already
 *  authorized for the current viewer, matching kudoCountsFor's contract. */
export async function siteEndorsementCounts(siteIds: string[]): Promise<Map<string, number>> {
  if (siteIds.length === 0) return new Map();
  const rows = await prisma.siteEndorsement.groupBy({
    by: ["siteId"],
    where: { siteId: { in: siteIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.siteId, row._count._all]));
}

export async function zoneEndorsementCounts(zoneIds: string[]): Promise<Map<string, number>> {
  if (zoneIds.length === 0) return new Map();
  const rows = await prisma.zoneEndorsement.groupBy({
    by: ["zoneId"],
    where: { zoneId: { in: zoneIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.zoneId, row._count._all]));
}
