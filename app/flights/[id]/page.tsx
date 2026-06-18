import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/brand/wordmark";
import { FlightHeader } from "@/components/flight/flight-header";
import { MetricTiles } from "@/components/flight/metric-tiles";
import { FlightViz } from "@/components/flight/flight-viz";
import { Card, CardBody } from "@/components/ui/card";

export default async function FlightPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS: returns the row only if the viewer owns it or it is public.
  const { data: flight } = await supabase
    .from("flights")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!flight) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = user?.id === flight.owner_id;
  const warnings = (flight.parse_warnings as string[] | null) ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-gray-200 px-6 py-4 sm:px-10">
        <Link href={isOwner ? "/logbook" : "/"}>
          <Wordmark className="text-xl" />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <FlightHeader flight={flight} />

        {flight.status === "failed" ? (
          <Card className="mt-8">
            <CardBody className="flex flex-col gap-2">
              <p className="font-condensed text-xl font-bold text-ink">
                We couldn&apos;t read this flight
              </p>
              <p className="text-gray-600">
                {flight.failure_reason ?? "The file didn't contain a usable track."}
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
                takeoffMs={flight.takeoff_at ? Date.parse(flight.takeoff_at) : 0}
                offsetMin={flight.local_utc_offset_minutes ?? 0}
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
      </main>
    </div>
  );
}
