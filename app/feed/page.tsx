import Link from "next/link";
import { KudosButton } from "@/components/flight/kudos-button";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/avatar";
import { listHighlights } from "@/lib/flights/list-highlights";
import { XcPendingRefresh } from "@/components/flight/xc-pending-refresh";
import { analysisPending } from "@/lib/flights/analysis-state";
import { requireProfile } from "@/lib/profile";
import { flightsSharedWithViewer, listFeedForViewer, trophiesForVisibleFlights } from "@/lib/flights/repo";
import { AppHeader } from "@/components/app-header";
import { FlightRow } from "@/components/logbook/flight-row";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feed — Leaf Log" };

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const profile = await requireProfile();
  const { cursor } = await searchParams;
  const feed = await listFeedForViewer(profile.id, {
    limit: 20,
    cursor: firstParam(cursor),
  });
  const { highlightScore, distanceScore } = listHighlights(feed.rows);
  const [trophies, sharedFlightIds, ownKudos] = await Promise.all([
    trophiesForVisibleFlights(feed.rows),
    flightsSharedWithViewer(profile.id, feed.rows.map(flight => flight.id)),
    prisma.kudo.findMany({
      where: { profileId: profile.id, flightId: { in: feed.rows.map(flight => flight.id) } },
      select: { flightId: true },
    }),
  ]);
  const kudoedIds = new Set(ownKudos.map(kudo => kudo.flightId));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <XcPendingRefresh pending={feed.rows.some(f => analysisPending(f.xcStatus))} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-10 sm:px-6">
        <SectionHeading as="h1">Feed</SectionHeading>

        {feed.rows.length === 0 ? (
          <Card className="mt-8">
            <CardBody className="flex flex-col items-center gap-4 py-14 text-center">
              <p className="font-condensed text-2xl font-bold text-ink">
                Add some friends to see their flights here.
              </p>
              <Button asChild size="lg">
                <Link href="/friends">Find friends</Link>
              </Button>
            </CardBody>
          </Card>
        ) : (
          <>
            <ul className="mt-8 flex flex-col gap-2">
              {feed.rows.map((flight, index) => (
                <li key={flight.id}>
                  {(index === 0 || feed.rows[index - 1].owner.handle !== flight.owner.handle) && <div className={`mb-3 px-1 ${index > 0 ? "mt-6" : ""}`}>
                    <Link href={`/@${flight.owner.handle}`} className="inline-flex min-w-0 max-w-full items-center gap-3 text-gray-600 hover:text-ink">
                      <Avatar handle={flight.owner.handle} displayName={flight.owner.displayName} avatarUpdatedAt={flight.owner.avatarUpdatedAt} className="h-16 w-16 text-2xl" />
                      <span className="min-w-0"><span className="block truncate font-condensed text-xl font-bold text-ink">{flight.owner.displayName}</span><span className="block truncate text-sm text-gray-500">@{flight.owner.handle}</span></span>
                    </Link>
                  </div>}
                  <div className="flex items-center gap-1 sm:gap-3">
                  <div className="min-w-0 flex-1">
                  <FlightRow
                    flight={flight}
                    compact
                    trophies={trophies[flight.id]}
                    highlightScore={highlightScore(flight)}
                    distanceScore={distanceScore(flight)}
                    friendFlightsFound={sharedFlightIds.has(flight.id)}
                    prioritizeSiteOnMobile
                  />
                  </div>
                  <div className="shrink-0"><KudosButton flightId={flight.id} initialCount={flight.kudoCount} initialKudoed={kudoedIds.has(flight.id)} canToggle={flight.ownerId !== profile.id} /></div>
                  </div>
                </li>
              ))}
            </ul>
            {feed.nextCursor && (
              <div className="mt-8 flex justify-center">
                <Button asChild variant="outline">
                  <Link href={`/feed?cursor=${encodeURIComponent(feed.nextCursor)}`}>
                    Load more
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
