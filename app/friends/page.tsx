import Link from "next/link";
import { connection } from "next/server";
import { requireProfile } from "@/lib/profile";
import {
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
} from "@/lib/social/friends";
import { AppHeader } from "@/components/app-header";
import { Avatar } from "@/components/avatar";
import { FriendSearch } from "@/components/social/friend-search";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
} from "@/app/[handle]/friend-action";

export const metadata = { title: "Friends — Leaf Log" };

export default async function FriendsPage() {
  await connection();
  const profile = await requireProfile();
  const [incoming, outgoing, friends] = await Promise.all([
    listIncomingRequests(profile.id),
    listOutgoingRequests(profile.id),
    listFriends(profile.id),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Friends</SectionHeading>
        <p className="mt-3 mb-8 text-gray-600">
          Manage requests and the pilots you fly with.
        </p>

        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
          <Card className="order-2 min-w-0 p-6 md:order-none">
            <h2 className="font-condensed text-lg font-bold text-ink">Friends</h2>
            <p className="mt-1 text-sm text-gray-600">Click a friend to see their flights.</p>
            {friends.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600">No friends yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-gray-100">
                {friends.map((friend) => (
                  <li key={friend.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <ProfileLink profile={friend} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="contents min-w-0 md:flex md:flex-col md:gap-6">
          <Card className={`${incoming.length > 0 ? "order-3" : "order-2"} p-6 md:order-none`}>
            <FriendSearch />
          </Card>

          <Card className={`${incoming.length > 0 ? "order-1" : "order-3"} p-6 md:order-none`}>
            <h2 className="font-condensed text-lg font-bold text-ink">
              Incoming requests
            </h2>
            {incoming.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600">No pending requests.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-gray-100">
                {incoming.map((req) => (
                  <li
                    key={`${req.requesterId}:${req.addresseeId}`}
                    className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <ProfileLink profile={req.requester} />
                    <div className="ml-auto flex items-center gap-2">
                      <form
                        action={async () => {
                          "use server";
                          await acceptFriendRequest(req.requester.handle);
                        }}
                      >
                        <Button type="submit" size="sm">
                          Accept
                        </Button>
                      </form>
                      <form
                        action={async () => {
                          "use server";
                          await declineFriendRequest(req.requester.handle);
                        }}
                      >
                        <Button type="submit" size="sm" variant="ghost">
                          Decline
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="order-4 p-6 md:order-none">
            <h2 className="font-condensed text-lg font-bold text-ink">
              Outgoing requests
            </h2>
            {outgoing.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600">No sent requests.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-gray-100">
                {outgoing.map((req) => (
                  <li
                    key={`${req.requesterId}:${req.addresseeId}`}
                    className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <ProfileLink profile={req.addressee} />
                    <form
                      action={async () => {
                        "use server";
                        await cancelFriendRequest(req.addressee.handle);
                      }}
                      className="ml-auto"
                    >
                      <Button type="submit" size="sm" variant="outline">
                        Cancel
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          </div>
        </div>
      </main>
    </div>
  );
}

function ProfileLink({
  profile,
}: {
  profile: {
    handle: string;
    displayName: string;
    avatarUpdatedAt: Date | null;
  };
}) {
  return (
    <Link href={`/@${profile.handle}`} className="flex min-w-0 items-center gap-3">
      <Avatar
        handle={profile.handle}
        displayName={profile.displayName}
        avatarUpdatedAt={profile.avatarUpdatedAt}
        className="h-10 w-10 text-sm"
      />
      <span className="min-w-0">
        <span className="block truncate font-condensed text-sm font-bold text-ink">
          {profile.displayName}
        </span>
        <span className="block truncate font-mono text-xs text-gray-500">
          @{profile.handle}
        </span>
      </span>
    </Link>
  );
}
