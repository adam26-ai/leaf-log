"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SESSION_MAX_AGE } from "@/lib/auth.config";
import { safeNext } from "@/lib/safe-next";

// Auth.js session-token cookie: `authjs.session-token` in dev, `__Secure-…` in
// prod, with `.0`, `.1` suffixes if the JWT is large enough to be chunked.
const SESSION_COOKIE = /authjs\.session-token(\.\d+)?$/;

/**
 * Apply the pilot's "keep me signed in?" choice by rewriting the session cookie's
 * lifetime: persistent (1 month) when remembered, or a session cookie (cleared on
 * browser close) otherwise. Re-sets the existing cookie value as-is — no JWT
 * re-encode — so it's just the Max-Age that changes.
 */
export async function setSessionPersistence(formData: FormData) {
  // Only a signed-in pilot can set their own session persistence.
  const session = await auth();
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!session?.user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);

  const remember = formData.get("remember") === "yes";
  const secure = process.env.NODE_ENV === "production";
  const jar = await cookies();
  for (const c of jar.getAll()) {
    if (!SESSION_COOKIE.test(c.name)) continue;
    jar.set(c.name, c.value, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      ...(remember ? { maxAge: SESSION_MAX_AGE } : {}), // omit → session cookie
    });
  }

  redirect(next);
}
