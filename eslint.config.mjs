import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["test/e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@playwright/test", importNames: ["test"], message: "Import test from ./fixtures so every browser session uses the shared network policy and diagnostics." }],
      }],
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='newContext']",
        message: "Use the newContext fixture for secondary pilots; it installs network fixtures and closes sessions after failures.",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
