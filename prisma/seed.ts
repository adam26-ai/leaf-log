import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Curated manual seed of well-known free-flight sites (the documented Plan B
// while ParaglidingEarth bulk-redistribution terms are unconfirmed).
const SITES = [
  { name: "Mussel Rock", kind: "both", lat: 37.6685, lon: -122.4936, countryCode: "US", region: "California" },
  { name: "Fort Funston", kind: "both", lat: 37.7172, lon: -122.5022, countryCode: "US", region: "California" },
  { name: "Ed Levin", kind: "both", lat: 37.4699, lon: -121.8638, countryCode: "US", region: "California" },
  { name: "Torrey Pines", kind: "both", lat: 32.89, lon: -117.252, countryCode: "US", region: "California" },
  { name: "Point of the Mountain", kind: "both", lat: 40.4828, lon: -111.903, countryCode: "US", region: "Utah" },
  { name: "Chelan Butte", kind: "takeoff", lat: 47.819, lon: -120.029, countryCode: "US", region: "Washington" },
  { name: "Col de la Forclaz", kind: "takeoff", lat: 45.8186, lon: 6.2256, countryCode: "FR", region: "Annecy" },
  { name: "Interlaken (Beatenberg)", kind: "takeoff", lat: 46.696, lon: 7.796, countryCode: "CH", region: "Bern" },
  { name: "Oludeniz (Babadag)", kind: "takeoff", lat: 36.556, lon: 29.12, countryCode: "TR", region: "Mugla" },
  { name: "Bir Billing", kind: "takeoff", lat: 32.044, lon: 76.718, countryCode: "IN", region: "Himachal" },
  { name: "Stanwell Park", kind: "both", lat: -34.227, lon: 150.987, countryCode: "AU", region: "NSW" },
  { name: "Sun Valley (Bald Mtn)", kind: "takeoff", lat: 43.675, lon: -114.362, countryCode: "US", region: "Idaho" },
];

async function main() {
  for (const s of SITES) {
    // Idempotent by name for the curated seed.
    const existing = await prisma.site.findFirst({ where: { name: s.name } });
    if (existing) {
      await prisma.site.update({ where: { id: existing.id }, data: { ...s, source: "manual", license: "curated" } });
    } else {
      await prisma.site.create({ data: { ...s, source: "manual", license: "curated" } });
    }
  }
  const count = await prisma.site.count();
  console.log(`seeded sites — total ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
