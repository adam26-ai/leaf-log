import Link from "next/link";
import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AccentBar } from "@/components/ui/accent-bar";
import { Wordmark } from "@/components/brand/wordmark";

async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/onboarding");
  await signIn("email", { email, redirectTo: next });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/onboarding" } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-2xl" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <form action={sendLink} className="flex w-full flex-col gap-5">
            <div className="flex flex-col gap-2 text-center">
              <h1 className="font-condensed text-3xl font-bold text-ink">
                Welcome to your logbook
              </h1>
              <AccentBar className="mx-auto" />
              <p className="text-gray-600">
                Enter your email and we&apos;ll send you a magic sign-in link — no
                password needed.
              </p>
            </div>
            <input type="hidden" name="next" value={next} />
            <input
              type="email"
              name="email"
              required
              autoFocus
              placeholder="you@example.com"
              className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
            />
            <Button type="submit" size="lg">
              Send magic link
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
