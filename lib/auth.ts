import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { sendMagicLink } from "@/lib/email";
import { authConfig } from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    // Custom email magic-link provider — no SMTP server; we send via Resend
    // (or the dev fallback) in sendVerificationRequest.
    {
      id: "email",
      type: "email",
      name: "Email",
      maxAge: 60 * 60, // link valid 1 hour
      from: process.env.AUTH_EMAIL_FROM ?? "Leaf Log <noreply@leaflog.local>",
      server: {},
      options: {},
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLink(identifier, url);
      },
    },
  ],
});
