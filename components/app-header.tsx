import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { AvatarMenu } from "@/components/avatar-menu";
import type { Profile } from "@/lib/profile";

/**
 * Top nav. Signed-in pilots get the full nav + avatar menu; a signed-out
 * viewer (this header also renders on pages anonymous/other-pilot viewers
 * can reach, like a flight or a public profile) gets just the wordmark.
 */
export function AppHeader({ profile }: { profile: Profile | null }) {
  if (!profile) {
    return (
      <header className="border-b border-gray-200 px-6 py-4 sm:px-10">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4 sm:px-10">
      <div className="flex items-center gap-6">
        <Link href="/logbook">
          <Wordmark className="text-xl" />
        </Link>
        <nav className="hidden gap-4 text-sm text-gray-600 sm:flex">
          <Link href="/logbook" className="hover:text-ink">
            Logbook
          </Link>
          <Link href="/feed" className="hover:text-ink">
            Feed
          </Link>
          <Link href="/upload" className="hover:text-ink">
            Upload
          </Link>
          <Link href={`/@${profile.handle}`} className="hover:text-ink">
            Profile
          </Link>
          <Link href="/ratings" className="hover:text-ink">
            Ratings
          </Link>
        </nav>
      </div>
      <AvatarMenu profile={profile} />
    </header>
  );
}
