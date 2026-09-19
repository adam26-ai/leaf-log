import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    allowOnly: !process.env.CI,
    reporters: ["default", "junit"],
    outputFile: { junit: "test-results/vitest.xml" },
    // Integration files share the local database and global XC queue.
    fileParallelism: false,
    globalSetup: ["./test/unit-setup.ts"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", ".next-e2e", "test/e2e/**"],
  },
});
