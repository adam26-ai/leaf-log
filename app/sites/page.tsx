import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireProfile } from "@/lib/profile";
import { listManagedSites, siteMapInitialPoint } from "@/lib/sites/manage";
import { SiteManager } from "@/app/settings/sites/site-manager";
import { isSiteAdmin } from "@/lib/admin";

export const metadata = { title: "Sites — Leaf Log" };

export default async function SitesPage() {
  const profile = await requireProfile();
  const [sites, initialPoint, admin] = await Promise.all([listManagedSites(profile.id, true), siteMapInitialPoint(profile.id), isSiteAdmin(profile.id)]);
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <SectionHeading as="h1">Sites</SectionHeading>
        <div className="mt-6"><SiteManager includePublicSites={admin} initialPoint={initialPoint} sites={sites.map((site) => ({ ...site, updatedAt: site.updatedAt.toISOString() }))} /></div>
      </main>
    </div>
  );
}
