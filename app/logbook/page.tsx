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

export default async function LogbookPage() {
  const profile = await requireProfile();
  const [flights, friendCount] = await Promise.all([
    listOwnFlights(profile.id),
    countFriends(profile.id),
  ]);
  const stats = statsFrom(flights);
  const readyFlights = flights.filter((flight) => flight.status === "ready");
  const maxDuration = readyFlights.reduce((max, flight) => Math.max(max, flight.durationS ?? 0), 0);
  const maxGain = readyFlights.reduce((max, flight) => Math.max(max, flight.altGainM ?? 0), 0);
  const maxDistance = readyFlights.reduce((max, flight) => Math.max(max, flight.straightDistM ?? 0), 0);
  const distanceScore = (flight: (typeof flights)[number]) =>
    flight.status === "ready" && maxDistance > 0
      ? Math.max(0, flight.straightDistM ?? 0) / maxDistance
      : 0;
  const highlightScore = (flight: (typeof flights)[number]) => {
    if (flight.status !== "ready") return 0;
    const dimensions = Number(maxDuration > 0) + Number(maxGain > 0);
    if (!dimensions) return 0;
    return ((maxDuration ? Math.max(0, flight.durationS ?? 0) / maxDuration : 0)
      + (maxGain ? Math.max(0, flight.altGainM ?? 0) / maxGain : 0)) / dimensions;
  };

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
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
              {flights.map((f) => (
                <li key={f.id}>
                  <FlightRow flight={f} compact highlightScore={highlightScore(f)} distanceScore={distanceScore(f)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
