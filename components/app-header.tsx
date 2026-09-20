import Link from "next/link";
import { BookOpen, GraduationCap, MapPin, Rss, Plus, Users } from "lucide-react";
import { LeafLogLogo } from "@/components/brand/leaf-log-logo";
import { HeaderAccount } from "@/components/header-account";
import { SunnyCloudIcon } from "@/components/icons/sunny-cloud-icon";
import type { Profile } from "@/lib/profile";

const BASE_NAV_ITEMS = [
  { href: "/logbook", label: "Logbook", icon: BookOpen },
  { href: "/feed", label: "Feed", icon: Rss },
  { href: "/friends", label: "Friends", icon: Users },
];
const RATINGS_NAV_ITEM = { href: "/ratings", label: "Ratings", icon: GraduationCap };
const SITES_NAV_ITEM = { href: "/sites", label: "Sites", icon: MapPin };
const UPLOAD_NAV_ITEM = { href: "/upload", label: "Add flight", icon: Plus };

/**
 * Top nav. Signed-in pilots get the full nav + settings link; a signed-out
 * viewer (this header also renders on pages anonymous/other-pilot viewers
 * can reach, like a flight or a public profile) gets a sign-in link.
 */
export function AppHeader({ profile }: { profile: Profile | null }) {
  if (!profile) {
    return (
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-paper px-2 py-3 sm:py-4 sm:px-10">
        <Link href="/">
          <LeafLogLogo />
        </Link>
        <Link href="/sign-in" className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-ink hover:text-brand-blue-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
          <SunnyCloudIcon aria-hidden="true" className="h-6 w-6 shrink-0" />
          Sign in
        </Link>
      </header>
    );
  }

  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(profile.ratingsTrackingEnabled ? [RATINGS_NAV_ITEM] : []),
    SITES_NAV_ITEM,
    UPLOAD_NAV_ITEM,
  ];

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-1 border-b border-gray-200 bg-paper px-2 py-3 sm:gap-2 sm:px-4 sm:py-4 xl:px-10">
      <div className="flex shrink-0 items-center gap-1 sm:gap-3 xl:gap-6">
        <Link href="/logbook" className="shrink-0 [&_img]:w-16 min-[360px]:[&_img]:w-[84px] sm:[&_img]:w-[112px]">
          <LeafLogLogo />
        </Link>
        <nav aria-label="Main navigation" className="flex shrink-0 items-center gap-0 text-sm sm:gap-1 xl:gap-2">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-100 p-0 font-medium text-slate-700 transition-colors hover:border-[#0099FF] hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0099FF] sm:h-[38px] sm:w-[38px] xl:w-auto xl:px-4"
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#0099FF]" />
              <span className="sr-only xl:not-sr-only">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
      <HeaderAccount handle={profile.handle} displayName={profile.displayName} avatarUpdatedAt={profile.avatarUpdatedAt} />
    </header>
  );
}
