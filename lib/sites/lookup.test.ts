// @vitest-environment node
//
// Integration test for the PostGIS KNN site lookup against the seeded sites.
// Skips when no local Supabase is configured.
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findSite } from "./lookup";
import type { Database } from "@/lib/database.types";

try {
  (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    ".env.local",
  );
} catch {
  /* skip below */
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && SERVICE ? describe : describe.skip;

d("findSite (PostGIS KNN)", () => {
  let db: SupabaseClient<Database>;
  beforeAll(() => {
    db = createClient<Database>(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("names a known launch from its coordinates", async () => {
    const site = await findSite(db, 37.6685, -122.4936, "takeoff");
    expect(site?.name).toBe("Mussel Rock");
  });

  it("names at least 3 known seeded sites", async () => {
    const checks: [number, number, string][] = [
      [37.4699, -121.8638, "Ed Levin"],
      [40.4828, -111.903, "Point of the Mountain"],
      [46.696, 7.796, "Interlaken (Beatenberg)"],
    ];
    for (const [lat, lon, name] of checks) {
      const site = await findSite(db, lat, lon, "takeoff");
      expect(site?.name).toBe(name);
    }
  });

  it("returns null when no site is within range", async () => {
    // Middle of the Pacific — nothing seeded nearby.
    const site = await findSite(db, 0, -140, "takeoff");
    expect(site).toBeNull();
  });

  it("respects the tighter takeoff radius", async () => {
    // ~3 km north of Mussel Rock — outside the 600 m takeoff radius.
    const site = await findSite(db, 37.695, -122.4936, "takeoff");
    expect(site).toBeNull();
  });
});
