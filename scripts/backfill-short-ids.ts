/**
 * Rewrite long (cuid) Flight ids to 4-char short ids. Idempotent — only touches
 * flights whose id is longer than a short id. FlightData.flightId cascades via the
 * Postgres FK (ON UPDATE CASCADE). Run in maintenance mode (no concurrent writes).
 * Existing long-id bookmarks 404 afterward — accepted at this early stage.
 *
 *   pnpm db:backfill-short-ids
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/prisma";
import { generateShortId, SHORT_ID_LENGTH } from "@/lib/short-id";

async function main() {
  const flights = await prisma.flight.findMany({ select: { id: true } });
  const taken = new Set(flights.map((f) => f.id));

  let updated = 0;
  for (const f of flights) {
    if (f.id.length <= SHORT_ID_LENGTH) continue;
    let nid = generateShortId();
    let guard = 0;
    while (taken.has(nid) && guard < 10) {
      nid = generateShortId();
      guard++;
    }
    taken.delete(f.id);
    taken.add(nid);
    await prisma.flight.update({ where: { id: f.id }, data: { id: nid } });
    updated++;
  }
  console.log(`backfilled ${updated} flight id(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
