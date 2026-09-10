import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { listOwnFlights } from "@/lib/flights/repo";
import { analysisPending } from "@/lib/flights/analysis-state";
import { AnalysisNotice } from "@/components/logbook/analysis-notice";
import { countFriends } from "@/lib/social/friends";
import { AppHeader } from "@/components/app-header";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LogbookList } from "@/components/logbook/logbook-list";
import { flightTrophies } from "@/lib/flights/trophies";
import { XcPendingRefresh } from "@/components/flight/xc-pending-refresh";

export default async function LogbookPage() {
  const profile = await requireProfile();
  const [flights, friendCount] = await Promise.all([
    listOwnFlights(profile.id),
    countFriends(profile.id),
  ]);
  const trophies = flightTrophies(flights);
  // eslint-disable-next-line react-hooks/purity -- This authenticated server page samples queue age once per request.
  const renderedAt = Date.now();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <XcPendingRefresh pending={flights.some(f => analysisPending(f.xcStatus))} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-2 py-6 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <Avatar
            handle={profile.handle}
            displayName={profile.displayName}
            avatarUpdatedAt={profile.avatarUpdatedAt}
            variant="full"
            className="h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl"
          />
          <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
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
            <Link href="/upload">Add flight</Link>
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
                Upload an IGC recording or add a flight from your logbook.
              </p>
              <Button asChild size="lg">
                <Link href="/upload">Add your first flight</Link>
              </Button>
            </CardBody>
          </Card>
        ) : (
          <><AnalysisNotice flights={flights} now={renderedAt} /><LogbookList key={profile.id} ownerId={profile.id} flights={flights} trophies={trophies} /></>

        )}
      </main>
    </div>
  );
}
