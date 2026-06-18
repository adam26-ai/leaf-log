import { Resend } from "resend";
import { writeFileSync } from "node:fs";

/**
 * Send a magic sign-in link. In production (RESEND_API_KEY set) it goes via
 * Resend; in local dev it's written to a file + logged so you (and the e2e
 * suite) can use it without a real mailbox.
 */
export async function sendMagicLink(to: string, url: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "Leaf Log <noreply@leaflog.local>";

  if (key) {
    const resend = new Resend(key);
    await resend.emails.send({
      from,
      to,
      subject: "Your Leaf Log sign-in link",
      html: `
        <p>Welcome to Leaf Log.</p>
        <p><a href="${url}">Click here to sign in</a>. This link expires in an hour.</p>
        <p>If you didn't request this, you can ignore this email.</p>`,
    });
    return;
  }

  // Dev fallback — no external email.
  try {
    writeFileSync("/tmp/leaf-magic-link.txt", url);
  } catch {
    /* ignore */
  }
  console.log(`\n🔗 Magic sign-in link for ${to}:\n${url}\n`);
}
