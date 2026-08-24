/**
 * SPRINT-007: the combined community-info read for a public site/zone —
 * contributors, recent audit history (capped), and endorsement summary.
 * Returns null for a target the viewer can't see (private, or an
 * effectively-private zone), matching every other read path's fail-closed
 * convention. Nothing here is cached or denormalized — each field is a
 * fresh, cheap query at this app's scale.
 */
import { prisma } from "@/lib/prisma";
import { canSeeSite, canSeeZone, normalizeSiteVisibility } from "./visibility";
import { contributorsForSite, contributorsForZone, type Contributor } from "./contributors";
import { siteEndorsementSummary, zoneEndorsementSummary, type EndorsementSummary } from "./endorsements";

const RECENT_AUDIT_LIMIT = 20;

export interface AuditEntryView {
  id: string;
  action: string;
  actor: { handle: string; displayName: string } | null;
  detail: unknown;
  createdAt: Date;
}

export interface LocationCommunityInfo {
  contributors: Contributor[];
  recentAudit: AuditEntryView[];
  endorsement: EndorsementSummary;
}

async function recentAuditFor(where: { siteId: string } | { zoneId: string }): Promise<AuditEntryView[]> {
  const rows = await prisma.locationAuditEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: RECENT_AUDIT_LIMIT,
    select: {
      id: true,
      action: true,
      detail: true,
      createdAt: true,
      actor: { select: { handle: true, displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actor,
    detail: r.detail,
    createdAt: r.createdAt,
  }));
}

export async function siteCommunityInfo(
  siteId: string,
  viewerId: string | null,
): Promise<LocationCommunityInfo | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, visibility: true, ownerId: true },
  });
  if (!site) return null;
  if (!canSeeSite(normalizeSiteVisibility(site.visibility), site.ownerId, viewerId)) return null;

  const [contributors, recentAudit, endorsement] = await Promise.all([
    contributorsForSite(siteId),
    recentAuditFor({ siteId }),
    siteEndorsementSummary(siteId, viewerId),
  ]);
  return { contributors, recentAudit, endorsement: endorsement ?? { count: 0, hasEndorsed: false } };
}

export async function zoneCommunityInfo(
  zoneId: string,
  viewerId: string | null,
): Promise<LocationCommunityInfo | null> {
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

  const [contributors, recentAudit, endorsement] = await Promise.all([
    contributorsForZone(zoneId),
    recentAuditFor({ zoneId }),
    zoneEndorsementSummary(zoneId, viewerId),
  ]);
  return { contributors, recentAudit, endorsement: endorsement ?? { count: 0, hasEndorsed: false } };
}
