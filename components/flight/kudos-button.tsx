"use client";

import { useState, useTransition } from "react";
import { ThumbsUp } from "lucide-react";
import { toggleKudoAction } from "@/app/flights/[id]/kudos-action";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";

interface RecentKudoer {
  id: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: string | null;
}

function kudoLabel(count: number) {
  return count === 1 ? "1 kudos" : `${count} kudos`;
}

function RecentKudoers({
  count,
  recent,
}: {
  count: number;
  recent: RecentKudoer[];
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {recent.length > 0 && (
        <div className="flex shrink-0 -space-x-2">
          {recent.slice(0, 5).map((profile) => (
            <Avatar
              key={profile.id}
              handle={profile.handle}
              displayName={profile.displayName}
              avatarUpdatedAt={profile.avatarUpdatedAt}
              className="h-7 w-7 border-2 border-paper"
            />
          ))}
        </div>
      )}
      <span className="min-w-0 truncate text-sm text-gray-600">{kudoLabel(count)}</span>
    </div>
  );
}

export function KudosButton({
  flightId,
  initialCount,
  initialKudoed,
  recent,
  canToggle,
}: {
  flightId: string;
  initialCount: number;
  initialKudoed: boolean;
  recent: RecentKudoer[];
  canToggle: boolean;
}) {
  const [state, setState] = useState({
    count: initialCount,
    kudoed: initialKudoed,
  });
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (!canToggle || pending) return;

    const previous = state;
    const nextKudoed = !state.kudoed;
    setState({
      count: Math.max(0, state.count + (nextKudoed ? 1 : -1)),
      kudoed: nextKudoed,
    });

    startTransition(async () => {
      const res = await toggleKudoAction(flightId);
      if (!res.ok) {
        setState(previous);
        return;
      }
      setState((current) => ({
        ...current,
        kudoed: res.kudoed,
      }));
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <RecentKudoers count={state.count} recent={recent} />
      {canToggle && (
        <Button
          type="button"
          size="sm"
          variant={state.kudoed ? "leaf" : "outline"}
          disabled={pending}
          aria-pressed={state.kudoed}
          onClick={toggle}
        >
          <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          {state.kudoed ? "Kudoed" : "Kudos"}
        </Button>
      )}
    </div>
  );
}
