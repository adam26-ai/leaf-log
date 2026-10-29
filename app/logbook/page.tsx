import Link from "next/link";
import { LogbookProfileHeader } from "@/components/logbook/logbook-profile-header";
import { requireProfile } from "@/lib/profile";
import { listOwnFlights } from "@/lib/flights/repo";
import { analysisPending } from "@/lib/flights/analysis-state";
import { AnalysisNotice } from "@/components/logbook/analysis-notice";
import { countFriends } from "@/lib/social/friends";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LogbookList } from "@/components/logbook/logbook-list";
import { flightTrophies } from "@/lib/flights/trophies";
import { XcPendingRefresh } from "@/components/flight/xc-pending-refresh";
import css from "@/components/logbook/logbook-overview.module.css";

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
    <div className={css.page}>
      <AppHeader profile={profile} />
      <XcPendingRefresh pending={flights.some(f => analysisPending(f.xcStatus))} />
      <main className={`${css.main} mx-auto w-full max-w-4xl flex-1 px-2 sm:px-6`}>
        <LogbookProfileHeader ownerId={profile.id} handle={profile.handle} displayName={profile.displayName} avatarUpdatedAt={profile.avatarUpdatedAt} friendCount={friendCount} hasFlights={flights.length > 0} />
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
