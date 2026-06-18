import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config — no Prisma, no Resend. Used by the proxy (middleware)
 * to read the JWT session. The full config in lib/auth.ts spreads this and adds
 * the adapter + email provider (Node-only).
 */
export const authConfig = {
  session: { strategy: "jwt" },
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
