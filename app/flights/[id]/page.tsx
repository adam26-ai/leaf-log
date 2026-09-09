import { UnitToggle } from "@/components/flight/unit-toggle";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { getCurrentProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import {
  getFlightForViewer,
  listOwnFlights,
  listProfileFlightsForViewer,
} from "@/lib/flights/repo";
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
          select: { id: true, handle: true, displayName: true, avatarUpdatedAt: true },
        });
  const isViewerCurrentInstructor = viewerId !== null && viewerId === flight.instructorId;
  const instructorNotes = viewerId
    ? await listInstructorNotesForViewer(flight.id, viewerId)
    : [];
  const navigationFlights = isOwner
    ? await listOwnFlights(flight.ownerId)
    : await listProfileFlightsForViewer(flight.ownerId, viewerId);
  const navigationIndex = navigationFlights.findIndex((row) => row.id === flight.id);
  // Logs are newest-first: left goes to the previous (older) log and right
  // goes to the next (newer) log.
  const previousFlightId =
    navigationIndex >= 0 ? navigationFlights[navigationIndex + 1]?.id ?? null : null;
  const nextFlightId =
    navigationIndex > 0 ? navigationFlights[navigationIndex - 1]?.id ?? null : null;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={viewer} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-2 pt-3 sm:px-6">
        <div className="relative left-1/2 w-[calc(100vw-16px)] sm:w-[92vw] lg:w-[80vw] -translate-x-1/2">
          <FlightHeader
            flight={flight}
            isOwner={isOwner}
            previousFlightId={previousFlightId}
            nextFlightId={nextFlightId}
            actions={
              <div className="flex shrink-0 items-center gap-3">
                <UnitToggle />
                {isOwner && (
                  <ShareToggle
                    flightId={flight.id}
                    visibility={normalizeVisibility(flight.visibility)}
                  />
                )}
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
            }
          />
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
            <div className="relative z-30 left-1/2 mt-2 w-[calc(100vw-16px)] sm:w-[92vw] lg:w-[80vw] -translate-x-1/2">
              <KeyStatistics flight={flight} canCalculateXc={isOwner} />
            </div>
            <div className="mt-2">
              <FlightViz
                viewerId={viewerId}
                primaryPilot={{ id: flight.ownerId, handle: owner?.handle ?? "", displayName: owner?.displayName ?? flight.pilot ?? "Pilot", avatarUpdatedAt: owner?.avatarUpdatedAt?.toISOString() ?? null }}
                xcScore={flight.xcScore}
                key={flight.id}
                flightId={flight.id}
                canAddPhotos={isOwner}
                takeoffMs={flight.takeoffAt ? flight.takeoffAt.getTime() : 0}
                offsetMin={flight.localUtcOffsetMinutes ?? 0}
                pilotName={flight.pilot || owner?.displayName}
                notes={flight.notes}
              />
            </div>
          </>
        )}

        {(instructorNotes.length > 0 || isViewerCurrentInstructor) && (
          <div className="mt-8">
            <InstructorNoteCard
              flightId={flight.id}
              notes={instructorNotes}
              viewerId={viewerId}
              isViewerCurrentInstructor={isViewerCurrentInstructor}
            />
          </div>
        )}

        {isOwner && warnings.length > 0 && (
          <Card className="mt-8 border-brand-blue/40 bg-brand-blue/5">
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
