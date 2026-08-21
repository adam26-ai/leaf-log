/**
 * Operator remedy for bad public sites: rename / force-private / merge. Runs
 * with full DB authority outside any pilot's session — no ownership gate,
 * because that's the point: it's the mitigation for a bad public name that
 * nobody else in the app can fix (this sprint deliberately ships without a
 * moderation queue).
 *
 * Raw `prisma.site.delete` is forbidden everywhere else in the app
 * (lib/sites/associate.ts's deleteSite is the one sanctioned, guarded path).
 * `merge` is the one place here that deletes a site directly — and only
 * after reassigning every reference away from it, in the same transaction,
 * so the delete never runs against a site still holding a live reference.
 *
 *   pnpm exec tsx scripts/admin-sites.ts rename <siteId> "<new name>"
 *   pnpm exec tsx scripts/admin-sites.ts force-private <siteId>
 *   pnpm exec tsx scripts/admin-sites.ts merge <fromSiteId> <intoSiteId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/prisma";
import { validateSiteName } from "@/lib/sites/name";
import { locationCachePatch } from "@/lib/sites/associate";

async function rename(siteId: string, rawName: string) {
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

async function forcePrivate(siteId: string) {
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
async function merge(fromSiteId: string, intoSiteId: string) {
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
  } else {
    throw new Error(`Unknown command "${cmd ?? ""}". Use: rename | force-private | merge`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
