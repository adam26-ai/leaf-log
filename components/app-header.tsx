import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/actions";
import type { Profile } from "@/lib/profile";

/** Top nav for authenticated pages. */
export function AppHeader({ profile }: { profile: Profile }) {
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
          <Link href="/upload" className="hover:text-ink">
            Upload
          </Link>
          <Link href={`/@${profile.handle}`} className="hover:text-ink">
            Profile
          </Link>
          <Link href="/settings" className="hover:text-ink">
            Settings
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          title="Profile & settings"
          className="rounded-full transition-opacity hover:opacity-80"
        >
          <Avatar
            handle={profile.handle}
            displayName={profile.displayName}
            avatarUpdatedAt={profile.avatarUpdatedAt}
            className="h-8 w-8 text-xs"
          />
        </Link>
        <form action={signOutAction}>
          <Button size="sm" variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
