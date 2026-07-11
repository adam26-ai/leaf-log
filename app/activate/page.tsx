import Link from "next/link";
import { getCurrentUserId, getCurrentProfile } from "@/lib/profile";
import { Wordmark } from "@/components/brand/wordmark";
import { AccentBar } from "@/components/ui/accent-bar";
import { Button } from "@/components/ui/button";
import { ActivateConfirm } from "./activate-confirm";

export const metadata = { title: "Connect your Leaf — Leaf Log" };
export const dynamic = "force-dynamic";

/**
 * Device activation landing (opened from the QR/link the Leaf shows). Reads the
 * pairing `code` from the URL; once the pilot is signed in + onboarded, one tap
 * claims the device. Claiming still requires a real login (the QR only replaces
 * typing the code — the proof of account ownership is unchanged).
 */
export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const userId = await getCurrentUserId();
  const profile = userId ? await getCurrentProfile() : null;

  const back = `/activate?code=${encodeURIComponent(code ?? "")}`;

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-2xl" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="flex flex-col gap-2 text-center">
            <h1 className="font-condensed text-3xl font-bold text-ink">
              Connect your Leaf
            </h1>
            <AccentBar className="mx-auto" />
          </div>

          <div className="mt-6">
            {!code ? (
              <p className="text-center text-gray-600">
                This link is missing its activation code. Start the connection again
                on your Leaf to get a fresh code.
              </p>
            ) : !userId ? (
              <div className="flex flex-col gap-4 text-center">
                <p className="text-gray-600">
                  Sign in to finish connecting your Leaf vario to your logbook.
                </p>
                <Button asChild size="lg">
                  <Link href={`/sign-in?next=${encodeURIComponent(back)}`}>
                    Sign in to connect
                  </Link>
                </Button>
              </div>
            ) : !profile ? (
              <div className="flex flex-col gap-4 text-center">
                <p className="text-gray-600">
                  Finish setting up your profile first, then reopen this link to
                  connect your Leaf.
                </p>
                <Button asChild size="lg">
                  <Link href="/onboarding">Finish setting up</Link>
                </Button>
              </div>
            ) : (
              <ActivateConfirm code={code} displayName={profile.displayName} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
