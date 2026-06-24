import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/profile";
import { getFlightForViewer } from "@/lib/flights/repo";
import { Wordmark } from "@/components/brand/wordmark";
import { FlightHeader } from "@/components/flight/flight-header";
import { MetricTiles } from "@/components/flight/metric-tiles";
import { FlightViz } from "@/components/flight/flight-viz";
import { ShareToggle } from "@/components/flight/share-toggle";
import { DeleteFlightButton } from "@/components/flight/delete-flight-button";
import { Card, CardBody } from "@/components/ui/card";

export default async function FlightPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewerId = await getCurrentUserId();

  const flight = await getFlightForViewer(id, viewerId);
  if (!flight) notFound();

  const isOwner = viewerId === flight.ownerId;
  const warnings = Array.isArray(flight.parseWarnings)
    ? (flight.parseWarnings as string[])
    : [];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-gray-200 px-6 py-4 sm:px-10">
        <Link href={isOwner ? "/logbook" : "/"}>
          <Wordmark className="text-xl" />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <FlightHeader flight={flight} />
          {isOwner && (
            <ShareToggle
              flightId={flight.id}
              visibility={flight.visibility as "private" | "public"}
            />
          )}
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
              <MetricTiles flight={flight} />
            </div>
            <div className="mt-8">
              <FlightViz
                flightId={flight.id}
                takeoffMs={flight.takeoffAt ? flight.takeoffAt.getTime() : 0}
                offsetMin={flight.localUtcOffsetMinutes ?? 0}
                isOwner={isOwner}
              />
            </div>
          </>
        )}

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

        {isOwner && (
          <div className="mt-12 flex justify-end border-t border-gray-200 pt-6">
            <DeleteFlightButton flightId={flight.id} />
          </div>
        )}
      </main>
    </div>
  );
}
