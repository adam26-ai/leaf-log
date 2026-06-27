import type { NextAuthConfig } from "next-auth";

/** Persistent ("remember me") session lifetime: 1 month. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Edge-safe auth config — no Prisma, no Resend. Used by the proxy (middleware)
 * to read the JWT session. The full config in lib/auth.ts spreads this and adds
 * the adapter + email provider (Node-only).
 */
export const authConfig = {
  // `updateAge: maxAge` disables Auth.js's sliding-refresh, which would otherwise
  // re-issue the cookie with `maxAge` on a 24h interval — silently upgrading a
  // "don't remember me" session cookie back to a persistent one. With it off, the
  // per-login persistence choice (see /stay-signed-in) sticks for the full month.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE, updateAge: SESSION_MAX_AGE },
  trustHost: true,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/check-email",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
