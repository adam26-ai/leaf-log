/** Add short landing labels to existing local Feed layout fixtures. */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";

async function main() {
  const env = parse(readFileSync(".env.local"));
  const url = new URL(env.DATABASE_URL);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5437" || url.pathname !== "/leaf_log_dev") {
    throw new Error("Only the local leaf_log_dev database on port 5437 is supported.");
  }
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle: "uicompanion" } });
    if (owner.id !== "ui-demo-companion-user" || owner.displayName !== "Sky Friend (demo)") throw new Error("Expected demo account.");
    const landings = [
      { id: "ui-demo-feed-manual", landing: "Meadow" },
      { id: "ui-demo-companion-2jaz", landing: "Valley" },
      { id: "ui-demo-companion-ydtq", landing: "Beach", takeoff: "Mussel Rock" },
    ];
    const result = await db.$transaction(async tx => {
      const updated = [];
      for (const { id, landing, takeoff } of landings) {
        const flight = await tx.flight.findUniqueOrThrow({ where: { id } });
        if (flight.ownerId !== owner.id) throw new Error(`Not a demo flight: ${id}`);
        updated.push(await tx.flight.update({
          where: { id },
          data: {
            ...(takeoff ? { takeoffSiteName: takeoff, takeoffSiteAssignment: "custom_name", takeoffSiteId: null, takeoffZoneId: null, takeoffZoneName: null } : {}),
            landingSiteName: landing, landingSiteAssignment: "custom_name", landingSiteId: null, landingZoneId: null, landingZoneName: null,
          },
          select: { takeoffSiteName: true, landingSiteName: true },
        }));
      }
      return updated;
    });
    console.log(result);
  } finally {
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
