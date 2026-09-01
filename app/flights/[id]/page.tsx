import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { getCurrentProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { getFlightForViewer } from "@/lib/flights/repo";
import { normalizeVisibility } from "@/lib/flights/visibility";
import { kudoSummaryForViewer } from "@/lib/social/kudos";
import { listInstructorNotesForViewer } from "@/lib/ratings/notes";
import { AppHeader } from "@/components/app-header";
import { FlightHeader } from "@/components/flight/flight-header";
import { KeyStatistics } from "@/components/flight/key-statistics";
import { FlightViz } from "@/components/flight/flight-viz";
import { ShareToggle } from "@/components/flight/share-toggle";
import { KudosButton } from "@/components/flight/kudos-button";
import { InstructorNoteCard } from "@/components/flight/instructor-note-card";
import { Card, CardBody } from "@/components/ui/card";

export default async function FlightPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getCurrentProfile();
  const viewerId = viewer?.id ?? null;

  const flight = await getFlightForViewer(id, viewerId);
  if (!flight) notFound();

  const isOwner = viewerId === flight.ownerId;
  const warnings = Array.isArray(flight.parseWarnings)
    ? (flight.parseWarnings as string[])
    : [];
  const kudoSummary = viewerId
    ? await kudoSummaryForViewer(flight.id, viewerId)
    : null;
  const owner =
    isOwner && viewer
      ? viewer
      : await prisma.profile.findUnique({
          where: { id: flight.ownerId },
          select: { displayName: true },
        });
  const isViewerCurrentInstructor = viewerId !== null && viewerId === flight.instructorId;
  const instructorNotes = viewerId
    ? await listInstructorNotesForViewer(flight.id, viewerId)
    : [];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={viewer} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <FlightHeader flight={flight} isOwner={isOwner} />
          <div className="flex items-center gap-3">
            {isOwner && <ShareToggle visibility={normalizeVisibility(flight.visibility)} />}
            {kudoSummary && (
              <KudosButton
                flightId={flight.id}
                initialCount={kudoSummary.count}
                initialKudoed={kudoSummary.hasKudoed}
                canToggle={!isOwner}
              />
            )}
            {isOwner && (
              <Link
                href={`/flights/${flight.id}/edit`}
                title="Edit flight"
                aria-label="Edit flight"
                className="inline-flex items-center gap-1.5 text-gray-600 hover:text-ink"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>

        {flight.status === "failed" ? (
          <Card className="mt-8">
            <CardBody className="flex flex-col gap-2">
              <p className="font-condensed text-xl font-bold text-ink">
                We couldn&apos;t read this flight
              </p>
              <p className="text-gray-600">
                {flight.failureReason ?? "The file didn't contain a usable track."}
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            <div className="mt-8">
              <KeyStatistics flight={flight} />
            </div>
            <div className="mt-8">
              <FlightViz
                flightId={flight.id}
                takeoffMs={flight.takeoffAt ? flight.takeoffAt.getTime() : 0}
                offsetMin={flight.localUtcOffsetMinutes ?? 0}
                pilotName={owner?.displayName}
                notes={isOwner ? flight.notes : null}
              />
            </div>
          </>
        )}

        <div className="mt-8">
          <InstructorNoteCard
            flightId={flight.id}
            notes={instructorNotes}
            viewerId={viewerId}
            isViewerCurrentInstructor={isViewerCurrentInstructor}
          />
        </div>

        {isOwner && warnings.length > 0 && (
          <Card className="mt-8 border-amber/40 bg-amber/5">
            <CardBody className="flex flex-col gap-1">
              <p className="font-condensed text-sm font-bold tracking-wide text-ink">
                A few notes about this file
              </p>
              <ul className="list-disc pl-5 text-sm text-gray-600">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </main>
    </div>
  );
}
