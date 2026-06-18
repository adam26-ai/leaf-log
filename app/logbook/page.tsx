import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { listOwnFlights, statsFrom } from "@/lib/flights/repo";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { StatsBar } from "@/components/logbook/stats-bar";
import { FlightRow } from "@/components/logbook/flight-row";

export default async function LogbookPage() {
  const profile = await requireProfile();
  const flights = await listOwnFlights(profile.id);
  const stats = statsFrom(flights);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="flex items-end justify-between">
          <h1 className="font-condensed text-3xl font-bold tracking-tight text-ink">
            {profile.displayName}&apos;s logbook
          </h1>
          <Button asChild size="sm">
            <Link href="/upload">Upload flight</Link>
          </Button>
        </div>

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
            <ul className="mt-8 flex flex-col gap-2">
              {flights.map((f) => (
                <li key={f.id}>
                  <FlightRow flight={f} />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
