import Link from "next/link";
import { GraduationCap, MapPin, Rss, Plus, Users, Shield } from "lucide-react";
import { isMainAdmin } from "@/lib/admin";
import { LeafLogLogo } from "@/components/brand/leaf-log-logo";
import { HeaderAccount } from "@/components/header-account";
import { CurrentPageLink } from "@/components/current-page-link";
import { SunnyCloudIcon } from "@/components/icons/sunny-cloud-icon";
import type { Profile } from "@/lib/profile";
import { NavigationBadge, NavigationNotifications } from "@/components/navigation-notifications";

const BASE_NAV_ITEMS = [
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
export async function AppHeader({ profile, feedSeenThrough }: { profile: Profile | null; feedSeenThrough?: string }) {
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

  const mainAdmin = await isMainAdmin(profile.id);
  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(profile.ratingsTrackingEnabled ? [RATINGS_NAV_ITEM] : []),
    SITES_NAV_ITEM,
    ...(mainAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
    UPLOAD_NAV_ITEM,
  ];

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-1 border-b border-gray-200 bg-paper px-1 py-3 min-[360px]:px-2 sm:gap-2 sm:px-4 sm:py-4 xl:px-10">
      <div className="flex shrink-0 items-center gap-0.5 min-[360px]:gap-1 sm:gap-3 xl:gap-6">
        <CurrentPageLink href="/logbook" title="Your logbook" aria-label="Leaf Log — your logbook"
          className="shrink-0 rounded-full aria-[current=page]:ring-2 aria-[current=page]:ring-brand-blue-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
          <LeafLogLogo compact />
        </CurrentPageLink>
        <NavigationNotifications feedSeenThrough={feedSeenThrough} refreshKey={new Date().toISOString()}>
          <nav aria-label="Main navigation" className="flex shrink-0 items-center gap-px text-sm min-[360px]:gap-0.5 min-[400px]:gap-1 min-[480px]:gap-1.5 xl:gap-2">
            {navItems.map(({ href, label, icon: Icon }) => (
              <CurrentPageLink
                key={href}
                href={href}
                title={label}
                aria-label={label}
                className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-100 p-0 font-medium text-slate-700 transition-colors hover:border-[#0099FF] hover:bg-sky-50 aria-[current=page]:border-brand-blue-strong aria-[current=page]:bg-brand-blue-strong aria-[current=page]:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0099FF] min-[360px]:h-[34px] min-[360px]:w-[34px] min-[400px]:h-[38px] min-[400px]:w-[38px] min-[480px]:h-10 min-[480px]:w-10 xl:w-auto xl:px-4"
              >
                <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[#0099FF] group-aria-[current=page]:text-white" />
                <span className="sr-only xl:not-sr-only">{label}</span>
                {(href === "/feed" || href === "/friends") && <NavigationBadge kind={href === "/feed" ? "feed" : "friends"} />}
              </CurrentPageLink>
            ))}
          </nav>
        </NavigationNotifications>
      </div>
      <HeaderAccount handle={profile.handle} displayName={profile.displayName} avatarUpdatedAt={profile.avatarUpdatedAt} />
    </header>
  );
}
