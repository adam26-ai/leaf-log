import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { getCurrentProfile, getCurrentUserId } from "@/lib/profile";
import { PairClient } from "./pair-client";

export const metadata = { title: "Pair Leaf — Leaf Log" };

export default async function PairPage() {
  const profile = await getCurrentProfile();
  const userId = profile?.id ?? (await getCurrentUserId());

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-2xl" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <PairClient
          signedIn={Boolean(userId)}
          onboarded={Boolean(profile)}
          displayName={profile?.displayName}
        />
      </main>
    </div>
  );
}
