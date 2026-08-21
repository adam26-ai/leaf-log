/**
 * Operator remedy for bad public sites AND zones: rename / force-private /
 * merge, one level down as of SPRINT-005. Runs with full DB authority
 * outside any pilot's session — no ownership gate, because that's the
 * point: it's the mitigation for a bad public name that nobody else in the
 * app can fix (this sprint deliberately ships without a moderation queue).
 * SPRINT-005 decision 4 gives a SITE's own owner a scoped version of this
 * power over zones under their site (`lib/sites/associate.ts`'s
 * `renameZone`/`unpublishOwnZone`/`deleteZone`); this script remains the
 * remedy for everything that power doesn't reach — a zone under a site the
 * operator doesn't otherwise own, or reparenting across sites entirely.
 *
 * Raw `prisma.site.delete`/`prisma.zone.delete` are forbidden everywhere
 * else in the app (`lib/sites/associate.ts`'s `deleteSite`/`deleteZone` are
 * the sanctioned, guarded paths). `merge`/`zone-merge` are the only places
 * here that delete directly — and only after reassigning every reference
 * away, in the same transaction, so the delete never runs against a row
 * still holding a live reference.
 *
 *   pnpm exec tsx scripts/admin-sites.ts rename <siteId> "<new name>"
 *   pnpm exec tsx scripts/admin-sites.ts force-private <siteId>
 *   pnpm exec tsx scripts/admin-sites.ts merge <fromSiteId> <intoSiteId>
 *   pnpm exec tsx scripts/admin-sites.ts zone-rename <zoneId> "<new name>"
 *   pnpm exec tsx scripts/admin-sites.ts zone-force-private <zoneId>
 *   pnpm exec tsx scripts/admin-sites.ts zone-merge <fromZoneId> <intoZoneId>
 *   pnpm exec tsx scripts/admin-sites.ts list <siteId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/prisma";
import { validateSiteName } from "@/lib/sites/name";
import { locationCachePatch, type SiteEndpoint } from "@/lib/sites/associate";
import { normalizeSiteVisibility } from "@/lib/sites/visibility";

export async function rename(siteId: string, rawName: string) {
  const validated = validateSiteName(rawName);
  if (!validated.ok) throw new Error(`Invalid name (${validated.error}): "${rawName}"`);

  await prisma.$transaction(async (tx) => {
    await tx.site.findUniqueOrThrow({ where: { id: siteId } });
    const updated = await tx.site.update({
      where: { id: siteId },
      data: { name: validated.name, normalizedName: validated.normalizedName },
    });
    const cachedName = updated.visibility === "public" ? updated.name : null;
    await tx.flight.updateMany({ where: { takeoffSiteId: siteId }, data: { takeoffSiteName: cachedName } });
    await tx.flight.updateMany({ where: { landingSiteId: siteId }, data: { landingSiteName: cachedName } });
  });
  console.log(`renamed ${siteId} -> "${validated.name}"`);
}

export async function forcePrivate(siteId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.site.findUniqueOrThrow({ where: { id: siteId } });
    await tx.site.update({ where: { id: siteId }, data: { visibility: "private" } });
    await tx.flight.updateMany({ where: { takeoffSiteId: siteId }, data: { takeoffSiteName: null } });
    await tx.flight.updateMany({ where: { landingSiteId: siteId }, data: { landingSiteName: null } });
    // SPRINT-005: a demoted site must also null every zone cache under it —
    // the conjunction means no zone stays effectively public once its
    // parent isn't, regardless of the zone's own (untouched) visibility.
    await tx.flight.updateMany({ where: { takeoffSiteId: siteId }, data: { takeoffZoneName: null } });
    await tx.flight.updateMany({ where: { landingSiteId: siteId }, data: { landingZoneName: null } });
  });
  console.log(`forced ${siteId} to private`);
}

/** Reassign every flight referencing fromSiteId onto intoSiteId, then delete fromSiteId. */
export async function merge(fromSiteId: string, intoSiteId: string) {
  if (fromSiteId === intoSiteId) throw new Error("Cannot merge a site into itself.");

  await prisma.$transaction(async (tx) => {
    await tx.site.findUniqueOrThrow({ where: { id: fromSiteId } });
    let into = await tx.site.findUniqueOrThrow({ where: { id: intoSiteId } });

    // A merged site absorbing references from both endpoints should cover
    // both going forward — same "never narrow" rule as opposite-endpoint reuse.
    if (into.kind !== "both") {
      into = await tx.site.update({ where: { id: intoSiteId }, data: { kind: "both" } });
    }

    // Reassigning to a different parent site drops any zone binding this
    // flight had (a zone belongs to exactly one site, and locationCachePatch
    // with a null zone unconditionally clears both the id and name) — the
    // merge target has no equivalent zone to offer, so this is a deliberate
    // downgrade to bare-site precision, not a bug. It also means every zone
    // that was under fromSiteId is unreferenced by the time site.delete
    // cascades to it below, so no stale zone-name cache survives the merge.
    await tx.flight.updateMany({
      where: { takeoffSiteId: fromSiteId },
      data: locationCachePatch(into, null, "takeoff"),
    });
    await tx.flight.updateMany({
      where: { landingSiteId: fromSiteId },
      data: locationCachePatch(into, null, "landing"),
    });

    // Now unreferenced (every flight was just reassigned above, in this same
    // transaction) — safe to delete directly.
    await tx.site.delete({ where: { id: fromSiteId } });
  });
  console.log(`merged ${fromSiteId} into ${intoSiteId}`);
}

export async function zoneRename(zoneId: string, rawName: string) {
  const validated = validateSiteName(rawName);
  if (!validated.ok) throw new Error(`Invalid name (${validated.error}): "${rawName}"`);

  await prisma.$transaction(async (tx) => {
    await tx.zone.findUniqueOrThrow({ where: { id: zoneId } });
    const updated = await tx.zone.update({
      where: { id: zoneId },
      data: { name: validated.name, normalizedName: validated.normalizedName },
    });
    const site = await tx.site.findUniqueOrThrow({ where: { id: updated.siteId }, select: { visibility: true } });
    const siteIsPublic = normalizeSiteVisibility(site.visibility) === "public";
    const cachedName =
      siteIsPublic && normalizeSiteVisibility(updated.visibility) === "public" ? updated.name : null;
    await tx.flight.updateMany({ where: { takeoffZoneId: zoneId }, data: { takeoffZoneName: cachedName } });
    await tx.flight.updateMany({ where: { landingZoneId: zoneId }, data: { landingZoneName: cachedName } });
  });
  console.log(`renamed zone ${zoneId} -> "${validated.name}"`);
}

export async function zoneForcePrivate(zoneId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.zone.findUniqueOrThrow({ where: { id: zoneId } });
    await tx.zone.update({ where: { id: zoneId }, data: { visibility: "private" } });
    await tx.flight.updateMany({ where: { takeoffZoneId: zoneId }, data: { takeoffZoneName: null } });
    await tx.flight.updateMany({ where: { landingZoneId: zoneId }, data: { landingZoneName: null } });
  });
  console.log(`forced zone ${zoneId} to private`);
}

/**
 * Reassign every flight referencing fromZoneId onto intoZoneId, then delete
 * fromZoneId. Unlike site merge, this is also the reparenting remedy: the
 * target zone's own site wins on every reassigned flight — merging across
 * two different sites is a legitimate use (fixing a zone that was created
 * under the wrong parent), not just a same-site dedup.
 */
export async function zoneMerge(fromZoneId: string, intoZoneId: string) {
  if (fromZoneId === intoZoneId) throw new Error("Cannot merge a zone into itself.");

  await prisma.$transaction(async (tx) => {
    const from = await tx.zone.findUniqueOrThrow({ where: { id: fromZoneId } });
    let into = await tx.zone.findUniqueOrThrow({ where: { id: intoZoneId } });
    const intoSite = await tx.site.findUniqueOrThrow({ where: { id: into.siteId } });

    // Never narrow the target's kind — same rule as site merge and
    // opposite-endpoint reuse.
    if (into.kind !== "both" && into.kind !== from.kind) {
      into = await tx.zone.update({ where: { id: intoZoneId }, data: { kind: "both" } });
    }

    for (const endpoint of ["takeoff", "landing"] as SiteEndpoint[]) {
      const zoneIdField = endpoint === "takeoff" ? "takeoffZoneId" : "landingZoneId";
      await tx.flight.updateMany({
        where: { [zoneIdField]: fromZoneId },
        data: locationCachePatch(intoSite, into, endpoint),
      });
    }

    // Now unreferenced — safe to delete directly.
    await tx.zone.delete({ where: { id: fromZoneId } });
  });
  console.log(`merged zone ${fromZoneId} into ${intoZoneId}`);
}

/** Print a site and its zones — a read-only operator convenience, no writes. */
export async function list(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const zones = await prisma.zone.findMany({ where: { siteId }, orderBy: { createdAt: "asc" } });
  console.log(
    `Site ${site.id} "${site.name}" (${site.visibility}, kind=${site.kind}, owner=${site.ownerId ?? "none"})`,
  );
  if (zones.length === 0) {
    console.log("  (no zones — bare site)");
  }
  for (const z of zones) {
    console.log(`  Zone ${z.id} "${z.name}" (${z.visibility}, kind=${z.kind}, owner=${z.ownerId ?? "none"})`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === "rename") {
    const [siteId, name] = args;
    if (!siteId || !name) throw new Error("Usage: rename <siteId> <name>");
    await rename(siteId, name);
  } else if (cmd === "force-private") {
    const [siteId] = args;
    if (!siteId) throw new Error("Usage: force-private <siteId>");
    await forcePrivate(siteId);
  } else if (cmd === "merge") {
    const [fromSiteId, intoSiteId] = args;
    if (!fromSiteId || !intoSiteId) throw new Error("Usage: merge <fromSiteId> <intoSiteId>");
    await merge(fromSiteId, intoSiteId);
  } else if (cmd === "zone-rename") {
    const [zoneId, name] = args;
    if (!zoneId || !name) throw new Error("Usage: zone-rename <zoneId> <name>");
    await zoneRename(zoneId, name);
  } else if (cmd === "zone-force-private") {
    const [zoneId] = args;
    if (!zoneId) throw new Error("Usage: zone-force-private <zoneId>");
    await zoneForcePrivate(zoneId);
  } else if (cmd === "zone-merge") {
    const [fromZoneId, intoZoneId] = args;
    if (!fromZoneId || !intoZoneId) throw new Error("Usage: zone-merge <fromZoneId> <intoZoneId>");
    await zoneMerge(fromZoneId, intoZoneId);
  } else if (cmd === "list") {
    const [siteId] = args;
    if (!siteId) throw new Error("Usage: list <siteId>");
    await list(siteId);
  } else {
    throw new Error(
      `Unknown command "${cmd ?? ""}". Use: rename | force-private | merge | zone-rename | zone-force-private | zone-merge | list`,
    );
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
