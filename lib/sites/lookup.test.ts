// @vitest-environment node
//
// Integration test for haversine site lookup against the seeded sites.
// Skips when no local Postgres is configured.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });
import { findSite } from "./lookup";

const enabled = Boolean(process.env.DATABASE_URL);
const d = enabled ? describe : describe.skip;

d("findSite (haversine)", () => {
  let prisma: import("@/lib/prisma").Db;
  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("names a known launch from its coordinates", async () => {
    const site = await findSite(prisma, 37.6685, -122.4936, "takeoff");
    expect(site?.name).toBe("Mussel Rock");
  });

  it("names at least 3 known seeded sites", async () => {
    const checks: [number, number, string][] = [
      [37.4699, -121.8638, "Ed Levin"],
      [40.4828, -111.903, "Point of the Mountain"],
      [46.696, 7.796, "Interlaken (Beatenberg)"],
    ];
    for (const [lat, lon, name] of checks) {
      const site = await findSite(prisma, lat, lon, "takeoff");
      expect(site?.name).toBe(name);
    }
  });

  it("returns null when no site is within range", async () => {
    const site = await findSite(prisma, 0, -140, "takeoff");
    expect(site).toBeNull();
  });

  it("respects the tighter takeoff radius", async () => {
    // ~3 km north of Mussel Rock — outside the 600 m takeoff radius.
    const site = await findSite(prisma, 37.695, -122.4936, "takeoff");
    expect(site).toBeNull();
  });
});
