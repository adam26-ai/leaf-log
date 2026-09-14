import { requireProfile } from "@/lib/profile";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { AddFlightForm } from "@/components/upload/add-flight-form";
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
          Drop an .igc file from your Leaf (or any flight recorder). We&apos;ll parse it and build your flight
          page. Flights are private until you choose to share them.
        </p>
        <AddFlightForm options={options} imperial={profile.defaultUnits === "imperial"} />
      </main>
    </div>
  );
}
