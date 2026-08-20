import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sites are fully community-driven — there is no curated seed. A pilot
 * names their own unmatched takeoff/landing (SPRINT-004); that's the only
 * way a Site row is created. This script is kept (rather than deleted) as
 * the seed entry point `pnpm db:seed` / `prisma.seed` expect, in case
 * future non-site seed data is ever needed.
 */
async function main() {
  const count = await prisma.site.count();
  console.log(`no seed data — sites are fully community-driven (${count} existing site(s) untouched)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
