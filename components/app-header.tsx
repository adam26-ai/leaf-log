import Link from "next/link";
import { BookOpen, GraduationCap, Rss, Plus, Users } from "lucide-react";
import { AvatarMenu } from "@/components/avatar-menu";
import { LeafLogLogo } from "@/components/brand/leaf-log-logo";
import type { Profile } from "@/lib/profile";

const BASE_NAV_ITEMS = [
  { href: "/logbook", label: "Logbook", icon: BookOpen },
  { href: "/feed", label: "Feed", icon: Rss },
  { href: "/friends", label: "Friends", icon: Users },
];
const RATINGS_NAV_ITEM = { href: "/ratings", label: "Ratings", icon: GraduationCap };
const UPLOAD_NAV_ITEM = { href: "/upload", label: "Add flight", icon: Plus };

/**
 * Top nav. Signed-in pilots get the full nav + avatar menu; a signed-out
 * viewer (this header also renders on pages anonymous/other-pilot viewers
 * can reach, like a flight or a public profile) gets a sign-in link.
 */
export function AppHeader({ profile }: { profile: Profile | null }) {
  if (!profile) {
    return (
      <header className="flex items-center justify-between border-b border-gray-200 px-2 py-3 sm:px-6 sm:py-4 sm:px-10">
        <Link href="/">
          <LeafLogLogo />
        </Link>
        <Link href="/sign-in" className="rounded-full px-3 py-2 text-sm font-medium text-ink hover:text-brand-blue-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
          Sign in
        </Link>
      </header>
    );
  }

  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(profile.ratingsTrackingEnabled ? [RATINGS_NAV_ITEM] : []),
    UPLOAD_NAV_ITEM,
  ];

  return (
    <header className="flex items-center justify-between border-b border-gray-200 px-2 py-3 sm:px-6 sm:py-4 sm:px-10">
      <div className="flex items-center gap-2 sm:gap-6">
        <Link href="/logbook">
          <LeafLogLogo />
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-1 text-sm sm:gap-2">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className="inline-flex h-[38px] items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-2 sm:px-3 font-medium text-slate-700 transition-colors hover:border-[#0099FF] hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0099FF] lg:px-4"
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#0099FF]" />
              <span className="sr-only lg:not-sr-only">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
      <AvatarMenu profile={profile} />
    </header>
  );
}
