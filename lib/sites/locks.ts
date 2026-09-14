import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type LockDb = Pick<typeof prisma, "$queryRaw">;
/** Lock sites in a stable order before their flights, including shared-site edits. */
export async function lockSiteRows(tx: LockDb, ids: string[]) {
  const ordered = [...new Set(ids)].sort();
  if (ordered.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Site" WHERE "id" IN (${Prisma.join(ordered)}) ORDER BY "id" FOR UPDATE`);
}
export async function lockFlightRow(tx: LockDb, id: string, ownerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Flight" WHERE "id" = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
}

/** Lock the caller's linked flights after locking the affected site rows. */
export async function lockSiteFlights(tx: LockDb, ownerId: string, siteId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Flight" WHERE "ownerId" = ${ownerId}
    AND ("takeoffSiteId" = ${siteId} OR "landingSiteId" = ${siteId}) ORDER BY "id" FOR UPDATE`;
}
