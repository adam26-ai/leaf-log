import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { prisma } from "@/lib/prisma";
import { repairLaunchAltitudes } from "@/lib/maintenance/repair-launch-altitudes";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--once"].includes(arg))) {
    throw new Error("Usage: pnpm db:repair-launch-altitudes [--apply [--once]]");
  }
  const apply = args.includes("--apply"), once = args.includes("--once");
  const result = await repairLaunchAltitudes({ apply, once,
    report: (id, reason) => console.log(`${id}: ${reason}`) });
  console.log(`${apply ? "Launch altitude repair" : "Launch altitude repair preview"}: ${JSON.stringify(result)}`);
  if (result.deferred) console.log("Completion not recorded; deferred flights will be retried at the next deployment or manual run.");
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
