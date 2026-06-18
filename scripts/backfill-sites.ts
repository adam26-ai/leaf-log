/**
 * Backfill named sites for flights ingested before site lookup existed (or after
 * the site catalogue grows). Idempotent — only touches flights missing a site.
 *
 *   node --env-file=.env.local --import tsx scripts/backfill-sites.ts
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { findSite } from "@/lib/sites/lookup";

async function main() {
  const db = createAdminClient();
  const { data: flights } = await db
    .from("flights")
    .select("id, takeoff_lat, takeoff_lon, landing_lat, landing_lon")
    .is("takeoff_site_id", null)
    .not("takeoff_lat", "is", null);

  let updated = 0;
  for (const f of flights ?? []) {
    const [takeoff, landing] = await Promise.all([
      f.takeoff_lat != null && f.takeoff_lon != null
        ? findSite(db, f.takeoff_lat, f.takeoff_lon, "takeoff")
        : null,
      f.landing_lat != null && f.landing_lon != null
        ? findSite(db, f.landing_lat, f.landing_lon, "landing")
        : null,
    ]);
    if (!takeoff && !landing) continue;
    await db
      .from("flights")
      .update({
        takeoff_site_id: takeoff?.id ?? null,
        takeoff_site_name: takeoff?.name ?? null,
        landing_site_id: landing?.id ?? null,
        landing_site_name: landing?.name ?? null,
      })
      .eq("id", f.id);
    updated++;
  }
  console.log(`backfilled ${updated} flight(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
