import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction, switchEmailAction } from "@/lib/actions";
import { safeNext } from "@/lib/safe-next";
import { setSessionPersistence } from "./actions";
import { Button } from "@/components/ui/button";
import { AccentBar } from "@/components/ui/accent-bar";
import { LeafLogLogo } from "@/components/brand/leaf-log-logo";

/**
 * Post-magic-link interstitial: ask whether to stay signed in on this device,
 * then continue to the original destination. Two JS-free forms so it works
 * without client JavaScript.
 */
export default async function StaySignedInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);

  // Reached without a valid session (e.g. an expired link) — send back to sign-in.
  if (!session?.user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/">
          <LeafLogLogo />
        </Link>
        <form action={signOutAction}>
          <button type="submit" className="rounded-full px-3 py-2 text-sm font-medium text-ink hover:text-brand-blue-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Sign out</button>
        </form>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-sm flex-col gap-6 text-center">
          <div className="flex flex-col gap-2">
            <div className="mb-3 rounded-md border border-gray-200 bg-paper px-4 py-3 text-sm text-gray-600">
              <p>Signing in as <strong className="break-all font-medium text-ink">{session.user.email}</strong>.</p>
              <form action={switchEmailAction}>
                <button type="submit" className="mt-1 font-medium text-brand-blue-strong underline underline-offset-2 hover:text-ink">Use a different email</button>
              </form>
            </div>
            <h1 className="font-condensed text-3xl font-bold text-ink">
              You&apos;re signed in
            </h1>
            <AccentBar className="mx-auto" />
            <p className="text-gray-600">
              Keep you signed in on this device? On a shared or public computer,
              choose &ldquo;Just this time.&rdquo;
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <form action={setSessionPersistence}>
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="remember" value="yes" />
              <Button type="submit" size="lg" className="w-full">
                Keep me signed in
              </Button>
            </form>
            <form action={setSessionPersistence}>
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="remember" value="no" />
              <Button type="submit" size="lg" variant="outline" className="w-full">
                Just this time
              </Button>
            </form>
          </div>

          <p className="text-xs text-gray-500">
            &ldquo;Keep me signed in&rdquo; stays active for a month. &ldquo;Just
            this time&rdquo; signs you out when you close your browser.
          </p>
        </div>
      </main>
    </div>
  );
}
