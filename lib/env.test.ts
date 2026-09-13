// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { validateEnv } from "./env";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5437/leaf_log_dev?schema=public");
  vi.stubEnv("AUTH_SECRET", "test-secret-at-least-32-characters-long");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("AUTH_EMAIL_FROM", "");
  vi.stubEnv("LEAF_E2E", "");
});
afterEach(() => vi.unstubAllEnvs());

it("still requires real email configuration for a normal production server", () => {
  expect(() => validateEnv()).toThrow("RESEND_API_KEY is required in production");
  vi.stubEnv("RESEND_API_KEY", "configured-test-key");
  expect(() => validateEnv()).toThrow("AUTH_EMAIL_FROM is required in production");
  vi.stubEnv("AUTH_EMAIL_FROM", "Leaf Log <test@example.com>");
  expect(() => validateEnv()).not.toThrow();
});

it.each(["localhost", "127.0.0.1", "[::1]"])("allows local test email with an isolated schema on %s", host => {
  vi.stubEnv("LEAF_E2E", "1");
  vi.stubEnv("DATABASE_URL", `postgresql://test:test@${host}:5437/leaf_log_dev?schema=e2e_${"a".repeat(32)}`);
  expect(() => validateEnv()).not.toThrow();
});

it.each([
  "postgresql://test:test@db.example.com/db?schema=e2e_" + "a".repeat(32),
  "postgresql://test:test@localhost:5437/leaf_log_dev?schema=public",
  "postgresql://test:test@localhost:5437/leaf_log_dev?schema=e2e_invalid",
  "postgresql://test:test@localhost:5437/leaf_log_dev",
])("rejects test mode outside an isolated local schema: %s", database => {
  vi.stubEnv("LEAF_E2E", "1");
  vi.stubEnv("DATABASE_URL", database);
  expect(() => validateEnv()).toThrow("LEAF_E2E requires an isolated local Playwright database schema");
  expect(() => validateEnv()).toThrow("RESEND_API_KEY is required in production");
});

it("reports malformed database URLs as validation errors", () => {
  vi.stubEnv("DATABASE_URL", "invalid");
  expect(() => validateEnv()).toThrow("Invalid environment:");
});
