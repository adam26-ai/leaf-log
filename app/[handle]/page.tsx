import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listPublicFlights, statsFrom } from "@/lib/flights/repo";
import { getCurrentUserId } from "@/lib/profile";
import { countFriends, friendStateFor } from "@/lib/social/friends";
import { SectionHeading } from "@/components/ui/section-heading";
import { Wordmark } from "@/components/brand/wordmark";
import { Avatar } from "@/components/avatar";
import { StatsBar } from "@/components/logbook/stats-bar";
import { FlightRow } from "@/components/logbook/flight-row";
import { FriendButton } from "@/components/social/friend-button";

/**
 * Public pilot profile at /@handle. The leading "@" is required (Strava-style);
 * a bare segment without it 404s. Static routes take precedence.
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

  const profile = await prisma.profile.findUnique({ where: { handle } });
  if (!profile) notFound();

  // Only this pilot's PUBLIC, ready flights — never their private totals.
  const viewerId = await getCurrentUserId();
  const [flights, friendCount, friendState] = await Promise.all([
    listPublicFlights(profile.id),
    countFriends(profile.id),
    viewerId ? friendStateFor(viewerId, profile.id) : Promise.resolve("none" as const),
  ]);
  const stats = statsFrom(flights);

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="flex items-center gap-4">
          <Avatar
            handle={profile.handle}
            displayName={profile.displayName}
            avatarUpdatedAt={profile.avatarUpdatedAt}
            variant="full"
            className="h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="font-condensed text-4xl font-bold tracking-tight text-ink">
              {profile.displayName}
            </h1>
            <p className="font-mono text-gray-500">@{profile.handle}</p>
            <p className="text-sm text-gray-600">
              {friendCount} {friendCount === 1 ? "friend" : "friends"}
            </p>
          </div>
          {viewerId && viewerId !== profile.id && (
            <FriendButton targetHandle={profile.handle} initialState={friendState} />
          )}
        </div>
        {profile.bio && <p className="mt-3 max-w-2xl text-gray-700">{profile.bio}</p>}

        {flights.length > 0 && (
          <div className="mt-8">
            <StatsBar stats={stats} />
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
