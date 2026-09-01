import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/profile";
import { getFlightForViewer } from "@/lib/flights/repo";
import { normalizeVisibility } from "@/lib/flights/visibility";
import { formatLocationLabel } from "@/lib/sites/display";
import { AppHeader } from "@/components/app-header";
import { VisibilityEditor } from "@/components/flight/visibility-editor";
import { DeleteFlightButton } from "@/components/flight/delete-flight-button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { NotesEditor } from "./notes-editor";
import { PhotosSection } from "./photos-section";
import { FlightDetailsEditor } from "./flight-details-editor";

export default async function EditFlightPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getCurrentProfile();
  if (!viewer) notFound();

  // getFlightForViewer applies the normal read-privacy rules, which would
  // still return a friend's or the public's own visible flight — the
  // ownerId check below is what actually restricts this page to the owner.
  const flight = await getFlightForViewer(id, viewer.id);
  if (!flight || flight.ownerId !== viewer.id) notFound();

  const location =
    formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site";

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={viewer} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link
          href={`/flights/${flight.id}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to flight
        </Link>

        <SectionHeading as="h1">Edit flight</SectionHeading>
        <p className="mt-3 mb-8 text-gray-600">{location}</p>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="font-condensed text-lg font-bold text-ink">Visibility</h2>
            <VisibilityEditor
              flightId={flight.id}
              visibility={normalizeVisibility(flight.visibility)}
            />
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <h2 className="font-condensed text-lg font-bold text-ink">Flight details</h2>
            <p className="text-sm text-gray-600">
              Tandem flights are excluded from solo airtime, and Flight type / Launch type /
              Landing tags show up as self-reported tallies on your{" "}
              <Link href="/ratings" className="underline hover:text-ink">
                ratings progress
              </Link>{" "}
              page — an instructor&apos;s sign-off is still what counts as verified.
            </p>
            <FlightDetailsEditor
              flightId={flight.id}
              details={{
                occupancy: flight.occupancy,
                flightTypeTags: flight.flightTypeTags,
                launchTypes: flight.launchTypes,
                restrictedLandingField: flight.restrictedLandingField,
              }}
            />
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <h2 className="font-condensed text-lg font-bold text-ink">Notes</h2>
            <NotesEditor flightId={flight.id} notes={flight.notes ?? ""} />
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <h2 className="font-condensed text-lg font-bold text-ink">Photos</h2>
            <PhotosSection flightId={flight.id} />
          </Card>

          <Card className="flex flex-col gap-3 border-red-200 p-6">
            <h2 className="font-condensed text-lg font-bold text-ink">Danger zone</h2>
            <p className="text-sm text-gray-600">
              Deleting a flight removes its track, stats, and photos for good.
            </p>
            <div>
              <DeleteFlightButton flightId={flight.id} />
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
