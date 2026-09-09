import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Playwright's dev server separate from the interactive server/build.
  distDir: process.env.LEAF_E2E === "1" ? ".next-e2e" : ".next",
  // Phone testing uses the configured LAN auth host rather than localhost.
  allowedDevOrigins: [new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").hostname],
  // Keep native/WASM image deps out of the server bundle — they load from
  // node_modules at runtime (the nodejs runtime route handlers use). Bundling
  // sharp/libheif-wasm breaks them. (SPRINT-002 photos.)
  serverExternalPackages: ["sharp", "heic-convert", "libheif-js", "exifr", "igc-xc-score"],
  outputFileTracingIncludes: {
    "/*": ["./lib/igc/xc-worker.cjs", "./node_modules/igc-xc-score/**/*"],
  },
};

export default nextConfig;
