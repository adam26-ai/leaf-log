import Link from "next/link";
import { KudosButton } from "@/components/flight/kudos-button";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/avatar";
import { XcPendingRefresh } from "@/components/flight/xc-pending-refresh";
import { analysisPending } from "@/lib/flights/analysis-state";
import { requireProfile } from "@/lib/profile";
import { flightsSharedWithViewer, highlightsForVisibleFlights, listFeedForViewer, trophiesForVisibleFlights } from "@/lib/flights/repo";
import { AppHeader } from "@/components/app-header";
import { FlightRow } from "@/components/logbook/flight-row";
import { FeedLayoutProvider } from "@/components/logbook/feed-layout-provider";
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
  const feedSeenThrough = new Date().toISOString();
  const { cursor } = await searchParams;
  const feed = await listFeedForViewer(profile.id, {
    limit: 20,
    cursor: firstParam(cursor),
  });
  const [trophies, highlights, sharedFlightIds, ownKudos] = await Promise.all([
    trophiesForVisibleFlights(feed.rows),
    highlightsForVisibleFlights(feed.rows),
    flightsSharedWithViewer(profile.id, feed.rows.map(flight => flight.id)),
    prisma.kudo.findMany({
      where: { profileId: profile.id, flightId: { in: feed.rows.map(flight => flight.id) } },
      select: { flightId: true },
    }),
  ]);
  const kudoedIds = new Set(ownKudos.map(kudo => kudo.flightId));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} feedSeenThrough={feedSeenThrough} />
      <XcPendingRefresh pending={feed.rows.some(f => analysisPending(f.xcStatus))} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-[clamp(12px,3.75vw,24px)] py-10" style={{ WebkitTextSizeAdjust: "100%", textSizeAdjust: "100%" }}>
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
            <FeedLayoutProvider trophySets={feed.rows.map(flight => trophies[flight.id] ?? [])}>
            <ul className="mt-8 flex flex-col gap-2">
              {feed.rows.map((flight) => (
                <li key={flight.id} className="flex items-center gap-[var(--feed-row-gap)]">
                  <Link
                    href={`/@${flight.owner.handle}`}
                    title={`${flight.owner.displayName} (@${flight.owner.handle})`}
                    className="flex w-[var(--feed-pilot)] shrink-0 items-center gap-1.5 text-gray-600 hover:text-ink"
                  >
                    <Avatar handle={flight.owner.handle} displayName={flight.owner.displayName} avatarUpdatedAt={flight.owner.avatarUpdatedAt} className="h-[46px] w-[46px] text-base" />
                    <span className="min-w-0 max-w-full flex-1 leading-4">
                      <span className="block truncate font-condensed text-[14px] leading-5 font-bold text-ink [[data-feed-pilot-compact=true]_&]:line-clamp-2 [[data-feed-pilot-compact=true]_&]:whitespace-normal [[data-feed-pilot-compact=true]_&]:break-words">{flight.owner.displayName}</span>
                      <span className="block truncate text-xs text-gray-500 [[data-feed-pilot-compact=true]_&]:hidden">@{flight.owner.handle}</span>
                    </span>
                  </Link>
                  <div className="min-w-0 flex-1">
                  <FlightRow
                    flight={flight}
                    compact
                    feedLayout
                    trophies={trophies[flight.id]}
                    highlightScore={highlights[flight.id].highlightScore}
                    distanceScore={highlights[flight.id].distanceScore}
                    friendFlightsFound={sharedFlightIds.has(flight.id)}
                    prioritizeSiteOnMobile
                  />
                  </div>
                  <div className="w-10 shrink-0"><KudosButton stacked flightId={flight.id} initialCount={flight.kudoCount} initialKudoed={kudoedIds.has(flight.id)} canToggle={flight.ownerId !== profile.id} /></div>
                </li>
              ))}
            </ul>
            </FeedLayoutProvider>
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
