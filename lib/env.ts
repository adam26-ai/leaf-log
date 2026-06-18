import { z } from "zod";

/**
 * Environment validation. Required everywhere: DATABASE_URL, AUTH_SECRET.
 * Required in production: RESEND_API_KEY + AUTH_EMAIL_FROM (real magic-link email).
 */
const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
    AUTH_EMAIL_FROM: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    NEXT_PUBLIC_SITE_URL: z.string().optional(),
    NEXT_PUBLIC_MAPTILER_KEY: z.string().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (!env.RESEND_API_KEY) {
        ctx.addIssue({ code: "custom", message: "RESEND_API_KEY is required in production", path: ["RESEND_API_KEY"] });
      }
      if (!env.AUTH_EMAIL_FROM) {
        ctx.addIssue({ code: "custom", message: "AUTH_EMAIL_FROM is required in production", path: ["AUTH_EMAIL_FROM"] });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function validateEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
