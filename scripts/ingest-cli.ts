/**
 * Headless verification harness for the ingestion core.
 *
 *   # parse + derive only (no DB):
 *   pnpm exec tsx scripts/ingest-cli.ts <file.igc>
 *
 *   # full ingestFlight against the configured Postgres (needs an owner profile id):
 *   pnpm exec tsx scripts/ingest-cli.ts <file.igc> <ownerId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";

async function main() {
  const [file, ownerId] = process.argv.slice(2);
  if (!file) {
    console.error("usage: ingest-cli <file.igc> [ownerId]");
    process.exit(1);
  }
  const bytes = new Uint8Array(readFileSync(file));

  const parsed = parseIgc(bytes);
  console.log("headers:", parsed.headers);
  console.log("fixes:", parsed.fixes.length, "warnings:", parsed.warnings);
  const metrics = deriveMetrics(parsed);
  console.log("metrics:", metrics);

  if (ownerId) {
    const { ingestFlight } = await import("@/lib/ingest/ingest-flight");
    const result = await ingestFlight({ ownerId, bytes, source: "web_upload" });
    console.log("ingestFlight:", result);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
