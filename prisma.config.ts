import { config } from "dotenv";
// Load local dev env (gitignored) for Prisma CLI commands.
config({ path: ".env.local" });
config();

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
