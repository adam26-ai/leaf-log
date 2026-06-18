import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { StatsBar } from "@/components/logbook/stats-bar";
import { FlightRow } from "@/components/logbook/flight-row";

export default async function LogbookPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: flights } = await supabase
    .from("flights")
    .select(
      "id, flight_date, takeoff_at, takeoff_site_name, takeoff_site_id, duration_s, max_alt_m, visibility, status, local_utc_offset_minutes",
    )
    .eq("owner_id", profile.id)
    .order("flight_date", { ascending: false })
    .order("takeoff_at", { ascending: false });

  const list = flights ?? [];
  const ready = list.filter((f) => f.status === "ready");
  const stats = {
    totalSeconds: ready.reduce((s, f) => s + (f.duration_s ?? 0), 0),
    flightCount: ready.length,
    siteCount: new Set(ready.map((f) => f.takeoff_site_id).filter(Boolean)).size,
  };

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="flex items-end justify-between">
          <h1 className="font-condensed text-3xl font-bold tracking-tight text-ink">
            {profile.display_name}&apos;s logbook
          </h1>
          <Button asChild size="sm">
            <Link href="/upload">Upload flight</Link>
          </Button>
        </div>

        {list.length === 0 ? (
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
              {list.map((f) => (
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
