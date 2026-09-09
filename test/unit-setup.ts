import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** Integration tests must not scan or alter a developer's existing logbook. */
export default async function setup() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) return;
  const database = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
    throw new Error("Integration tests require a local PostgreSQL database");
  }
  const original = process.env.DATABASE_URL;
  const schema = `unit_${randomUUID().replaceAll("-", "")}`;
  database.hostname = "127.0.0.1";
  database.searchParams.set("schema", schema);
  process.env.DATABASE_URL = database.href;
  const db = new PrismaClient({ datasourceUrl: database.href });
  const cleanup = async () => {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
    process.env.DATABASE_URL = original;
  };
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
  } catch (error) {
    await cleanup();
    throw error;
  }
  return cleanup;
}
