import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { Wordmark } from "@/components/brand/wordmark";
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

  // RLS returns only this owner's public flights to a visitor.
  const { data: flights } = await supabase
    .from("flights")
    .select("id, flight_date, takeoff_site_name, duration_s, max_alt_m")
    .eq("owner_id", profile.id)
    .eq("visibility", "public")
    .order("flight_date", { ascending: false });

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

        <div className="mt-10">
          <SectionHeading>Public flights</SectionHeading>
          {!flights || flights.length === 0 ? (
            <p className="mt-6 text-gray-600">
              No public flights yet.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-2">
              {flights.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/flights/${f.id}`}
                    className="block rounded-md border border-gray-200 px-4 py-3 hover:bg-gray-50"
                  >
                    {f.takeoff_site_name ?? "Unknown site"} —{" "}
                    {f.flight_date ?? "—"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
