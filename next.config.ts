import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/WASM image deps out of the server bundle — they load from
  // node_modules at runtime (the nodejs runtime route handlers use). Bundling
  // sharp/libheif-wasm breaks them. (SPRINT-002 photos.)
  serverExternalPackages: ["sharp", "heic-convert", "libheif-js", "exifr", "igc-xc-score"],
  outputFileTracingIncludes: {
    "/*": ["./lib/igc/xc-worker.cjs", "./node_modules/igc-xc-score/**/*"],
  },
};

export default nextConfig;
