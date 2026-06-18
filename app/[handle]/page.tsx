import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { Wordmark } from "@/components/brand/wordmark";
import { StatsBar } from "@/components/logbook/stats-bar";
import { FlightRow } from "@/components/logbook/flight-row";
import Link from "next/link";

/**
 * Public pilot profile at /@handle. The leading "@" is required (Strava-style);
 * a bare segment without it 404s. Static routes (/logbook, /upload, …) take
 * precedence over this dynamic segment.
 *
 * Visibility is enforced by RLS: an anonymous visitor's Supabase client can only
 * read this pilot's PUBLIC flights.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: raw } = await params;
  const decoded = decodeURIComponent(raw);
  if (!decoded.startsWith("@")) notFound();
  const handle = decoded.slice(1).toLowerCase();

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, handle, display_name, bio")
    .eq("handle", handle)
    .maybeSingle();

  if (!profile) notFound();

  // RLS returns only this owner's public flights to a visitor. We additionally
  // filter to public so the owner viewing their own profile sees the public view.
  const { data: flightsRaw } = await supabase
    .from("flights")
    .select(
      "id, flight_date, takeoff_at, takeoff_site_name, takeoff_site_id, duration_s, max_alt_m, visibility, status, local_utc_offset_minutes",
    )
    .eq("owner_id", profile.id)
    .eq("visibility", "public")
    .eq("status", "ready")
    .order("flight_date", { ascending: false });

  const flights = flightsRaw ?? [];
  // Public stats are computed from PUBLIC flights only — never leak private totals.
  const publicStats = {
    totalSeconds: flights.reduce((s, f) => s + (f.duration_s ?? 0), 0),
    flightCount: flights.length,
    siteCount: new Set(flights.map((f) => f.takeoff_site_id).filter(Boolean)).size,
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-condensed text-4xl font-bold tracking-tight text-ink">
            {profile.display_name}
          </h1>
          <p className="font-mono text-gray-500">@{profile.handle}</p>
        </div>
        {profile.bio && <p className="mt-3 max-w-2xl text-gray-700">{profile.bio}</p>}

        {flights.length > 0 && (
          <div className="mt-8">
            <StatsBar stats={publicStats} />
          </div>
        )}

        <div className="mt-10">
          <SectionHeading>Public flights</SectionHeading>
          {flights.length === 0 ? (
            <p className="mt-6 text-gray-600">No public flights yet.</p>
          ) : (
            <ul className="mt-6 flex flex-col gap-2">
              {flights.map((f) => (
                <li key={f.id}>
                  <FlightRow flight={f} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
