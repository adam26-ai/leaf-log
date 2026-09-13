import { Prisma } from "@prisma/client";

/** Serialize wing defaults with flight creation/edits, including concurrent uploads. */
export async function lockWingSettings(tx: Pick<Prisma.TransactionClient, "$queryRaw">, ownerId: string) {
  const [profile] = await tx.$queryRaw<{ tandemWings: string[]; tandemEnabled: boolean }[]>`
    SELECT "tandemWings", "tandemEnabled" FROM "Profile" WHERE "id" = ${ownerId} FOR UPDATE`;
  if (!profile) throw new Error("Profile not found.");
  return profile;
}

export function tandemFlightData(flags: readonly string[], tandem: boolean) {
  return {
    flightFlags: tandem ? [...flags, ...(flags.includes("tandem") ? [] : ["tandem"])] : flags.filter(flag => flag !== "tandem"),
    occupancy: tandem ? "tandem" : "solo",
  };
}

export function wingIsTandem(tandemWings: readonly string[], glider: string | null) {
  return glider !== null && tandemWings.includes(glider);
}

/** Modify only inherited tandem status, atomically preserving every other flag. */
export async function applyWingTandemDefault(tx: Pick<Prisma.TransactionClient, "$executeRaw">, ownerId: string, glider: string | null, tandem: boolean, flightId?: string) {
  return tx.$executeRaw`
    UPDATE "Flight" SET
      "flightFlags" = array_remove("flightFlags", 'tandem') || ${tandem ? ["tandem"] : []}::text[],
      "occupancy" = ${tandem ? "tandem" : "solo"}, "updatedAt" = NOW()
    WHERE "ownerId" = ${ownerId} AND "glider" IS NOT DISTINCT FROM ${glider}
      AND "tandemOverride" IS NULL
      ${flightId ? Prisma.sql`AND "id" = ${flightId}` : Prisma.empty}
      AND (('tandem' = ANY("flightFlags")) <> ${tandem}
        OR "occupancy" IS DISTINCT FROM ${tandem ? "tandem" : "solo"})`;
}
