import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { listOwnFlights, statsFrom } from "@/lib/flights/repo";
import { countFriends } from "@/lib/social/friends";
import { AppHeader } from "@/components/app-header";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { StatsBar } from "@/components/logbook/stats-bar";
import { FlightRow } from "@/components/logbook/flight-row";
import { listHighlights } from "@/lib/flights/list-highlights";
import { xcRankings } from "@/lib/flights/xc-rankings";
import { XcPendingRefresh } from "@/components/flight/xc-pending-refresh";

export default async function LogbookPage() {
  const profile = await requireProfile();
  const [flights, friendCount] = await Promise.all([
    listOwnFlights(profile.id),
    countFriends(profile.id),
  ]);
  const stats = statsFrom(flights);
  const rankings = xcRankings(flights);
  const { highlightScore, distanceScore } = listHighlights(flights);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <XcPendingRefresh pending={flights.some(f => f.xcStatus === "queued")} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="flex items-center gap-4">
          <Avatar
            handle={profile.handle}
            displayName={profile.displayName}
            avatarUpdatedAt={profile.avatarUpdatedAt}
            variant="full"
            className="h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="break-words font-condensed text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {profile.displayName}
            </h1>
            <p className="text-sm text-gray-500">
              <span className="break-all font-mono text-lg sm:text-xl">@{profile.handle}</span>
              <span className="mx-2 text-gray-300" aria-hidden="true">·</span>
              {friendCount} {friendCount === 1 ? "friend" : "friends"}
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/upload">Upload flight</Link>
          </Button>
        </div>
        {profile.bio && <p className="mt-3 max-w-2xl text-gray-700">{profile.bio}</p>}

        {flights.length === 0 ? (
          <Card className="mt-8">
            <CardBody className="flex flex-col items-center gap-4 py-14 text-center">
              <p className="font-condensed text-2xl font-bold text-ink">
                No flights yet
              </p>
              <p className="max-w-md text-gray-600">
                Upload your first IGC file and watch your flight come to life.
              </p>
              <Button asChild size="lg">
                <Link href="/upload">Upload your first flight</Link>
              </Button>
            </CardBody>
          </Card>
        ) : (
          <>
            <div className="mt-8">
              <StatsBar stats={stats} />
            </div>
            <ul className="mt-6 flex flex-col gap-1 overflow-x-auto pb-1">
              {flights.map((f, index) => (
                <li key={f.id}>
                  <FlightRow flight={f} compact xcBadges={rankings.get(f.id) ?? []} highlightScore={highlightScore(f)} distanceScore={distanceScore(f)} previewAutoUpload={process.env.NODE_ENV === "development" && index < 5 && index % 2 === 0} />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
