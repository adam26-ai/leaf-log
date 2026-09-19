import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const ownerId = args.find(arg => arg.startsWith("--owner="))?.slice(8);
  const expected = args.find(arg => arg.startsWith("--expected="))?.slice(11);
  const apply = args.includes("--apply");
  if (!ownerId || args.some(arg => arg !== "--apply" && !arg.startsWith("--owner=") && !arg.startsWith("--expected="))) {
    throw new Error("Usage: node --import tsx scripts/migrate-site-locations.ts --owner=<pilot-id> [--apply --expected=<preview-signature>]");
  }
  const { prisma } = await import("../lib/prisma");
  try {
    const { previewSiteMigration, applySiteMigration } = await import("../lib/sites/migrate");
    if (apply) {
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Preview first, then supply its signature with --expected before applying.");
      console.log(await applySiteMigration(ownerId, expected, message => console.log(message)));
    } else console.log(await previewSiteMigration(ownerId));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Site migration failed."); process.exitCode = 1; });
