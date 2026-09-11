import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireProfile } from "@/lib/profile";
import { listManagedSites } from "@/lib/sites/manage";
import { SiteManager } from "./site-manager";

export const metadata = { title: "Sites — Leaf Log" };

export default async function SitesPage() {
  const profile = await requireProfile();
  const sites = await listManagedSites(profile.id);
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Sites</SectionHeading>
        <p className="mb-8 mt-3 max-w-3xl text-gray-600">
          Create and map sites independently of an IGC track. A site boundary only finds possible flights;
          changing it never changes your logbook until you review and confirm the flights below.
        </p>
        <SiteManager sites={sites.map((site) => ({ ...site, updatedAt: site.updatedAt.toISOString() }))} />
      </main>
    </div>
  );
}
