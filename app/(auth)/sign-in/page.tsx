"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AccentBar } from "@/components/ui/accent-bar";
import { Wordmark } from "@/components/brand/wordmark";

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/onboarding";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-3 text-center">
        <h1 className="font-condensed text-3xl font-bold text-ink">
          Check your email
        </h1>
        <AccentBar className="mx-auto" />
        <p className="text-gray-600">
          We sent a sign-in link to <span className="font-medium text-ink">{email}</span>.
          Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-condensed text-3xl font-bold text-ink">
          Welcome to your logbook
        </h1>
        <AccentBar className="mx-auto" />
        <p className="text-gray-600">
          Enter your email and we&apos;ll send you a magic sign-in link — no password needed.
        </p>
      </div>
      <input
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
      />
      <Button type="submit" size="lg" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send magic link"}
      </Button>
      {status === "error" && (
        <p className="text-center text-sm text-red-600">{message}</p>
      )}
    </form>
  );
}

export default function SignInPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-2xl" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Suspense fallback={null}>
            <SignInForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
