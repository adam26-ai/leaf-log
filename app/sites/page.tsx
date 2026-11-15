import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireProfile } from "@/lib/profile";
import { listManagedSites, previewFlightsForSite, siteMapInitialPoint } from "@/lib/sites/manage";
import { SiteManager } from "@/app/settings/sites/site-manager";
import { isSiteAdmin } from "@/lib/admin";

export const metadata = { title: "Sites — Leaf Log" };

export default async function SitesPage({ searchParams }: { searchParams: Promise<{ review?: string | string[] }> }) {
  const profile = await requireProfile();
  const [sites, initialPoint, admin, { review }] = await Promise.all([
    listManagedSites(profile.id, true), siteMapInitialPoint(profile.id), isSiteAdmin(profile.id), searchParams,
  ]);
  const reviewSite = typeof review === "string" ? sites.find(site => site.id === review) : undefined;
  const initialReview = reviewSite && {
    siteId: reviewSite.id,
    candidates: await previewFlightsForSite(profile.id, reviewSite.id, { recommend: true }).catch(error => {
      console.error("Could not load site matches", error);
      return null;
    }),
  };
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <SectionHeading as="h1">Sites</SectionHeading>
        <div className="mt-6"><SiteManager key={reviewSite?.id} initialReview={initialReview} includePublicSites={admin} initialPoint={initialPoint} sites={sites.map((site) => ({ ...site, updatedAt: site.updatedAt.toISOString() }))} /></div>
      </main>
    </div>
  );
}
