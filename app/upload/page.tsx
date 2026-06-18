import { requireProfile } from "@/lib/profile";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Dropzone } from "@/components/upload/dropzone";

export default async function UploadPage() {
  const profile = await requireProfile();
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Upload a flight</SectionHeading>
        <p className="mt-4 mb-8 text-gray-600">
          Drop an <span className="font-mono text-ink">.igc</span> file from your
          Leaf (or any flight recorder). We&apos;ll parse it and build your flight
          page. Flights are private until you choose to share them.
        </p>
        <Dropzone />
      </main>
    </div>
  );
}
