import { PrismaClient } from "@prisma/client";
import { createWithShortIdRetry } from "./short-id";

/**
 * Prisma client extended with a short-id injector on the URL-visible entities.
 * Only `Flight` is URL-visible (`/flights/<id>`); profiles use `@handle`, and
 * everything else stays on cuid. `@default(cuid())` remains in the schema (so
 * migrations/`db push` work) — the extension overrides at the JS layer on create.
 */
function buildClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return base.$extends({
    name: "short-id-injector",
    query: {
      flight: {
        create: ({ args, query }) => createWithShortIdRetry(args, query),
      },
    },
  });
}

export type Db = ReturnType<typeof buildClient>;

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
