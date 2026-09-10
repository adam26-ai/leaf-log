import { requireProfile } from "@/lib/profile";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Dropzone } from "@/components/upload/dropzone";
import { ManualEntryForm } from "@/components/logbook/manual-entry-form";
import { getEntryOptions } from "@/lib/logbook/options";

export default async function UploadPage() {
  const profile = await requireProfile();
  const options = await getEntryOptions(profile.id);
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Add flight</SectionHeading>
        <p className="mt-4 mb-8 text-gray-600">
          Drop an <span className="font-mono text-ink">.igc</span> file from your
          Leaf (or any flight recorder). We&apos;ll parse it and build your flight
          page. Flights are private until you choose to share them.
        </p>
        <Dropzone />
        <section className="mt-10 border-t border-gray-200 pt-8">
          <h2 className="mb-5 font-condensed text-2xl font-bold text-ink">Or manually enter flight details</h2>
          <ManualEntryForm options={options} imperial={profile.defaultUnits === "imperial"} />
        </section>
      </main>
    </div>
  );
}
