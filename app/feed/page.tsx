import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { listFeedForViewer } from "@/lib/flights/repo";
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

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
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
              {feed.rows.map((flight) => (
                <li key={flight.id}>
                  <FlightRow
                    flight={flight}
                    owner={flight.owner}
                    kudoCount={flight.kudoCount}
                  />
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
