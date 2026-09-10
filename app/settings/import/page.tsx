import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { getEntryOptions } from "@/lib/logbook/options";
import { listLogbookImports } from "@/lib/logbook/service";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { ImportWizard } from "@/components/logbook/import-wizard";
import { ImportHistory } from "@/components/logbook/import-history";

export const metadata = { title: "Import logbook — Leaf Log" };
export default async function ImportLogbookPage() {
  const profile = await requireProfile();
  const [options, imports] = await Promise.all([getEntryOptions(profile.id), listLogbookImports(profile.id)]);
  return <div className="flex flex-1 flex-col"><AppHeader profile={profile} /><main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6"><Link href="/settings" className="text-sm text-gray-500 hover:text-ink">← Settings</Link><div className="mt-4 mb-6"><SectionHeading as="h1">Import logbook</SectionHeading></div><ImportWizard options={options} /><ImportHistory imports={imports} /></main></div>;
}
