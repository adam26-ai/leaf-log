import type { Reporter } from "@playwright/test/reporter";
import { PrismaClient } from "@prisma/client";

export default class CleanupReporter implements Reporter {
  // Global teardown runs BEFORE webServer teardown. Wait until exit so the XC
  // worker has stopped before removing the temporary tables it was using.
  async onExit() {
    const schema = process.env.LEAF_E2E_SCHEMA;
    if (!schema || !/^e2e_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid isolated E2E schema");
    const db = new PrismaClient();
    try {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.$disconnect();
    }
  }
}
