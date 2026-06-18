import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
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
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="primary">
          <Link href="/upload">Upload flight</Link>
        </Button>
        <form action={signOutAction}>
          <Button size="sm" variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
