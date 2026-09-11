"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  removeFriendAction,
  sendFriendRequest,
} from "@/app/[handle]/friend-action";
import type { FriendState } from "@/lib/social/friends";
import { useHydrated } from "@/lib/use-hydrated";

export function FriendButton({
  targetHandle,
  initialState,
}: {
  targetHandle: string;
  initialState: FriendState;
}) {
  const hydrated = useHydrated();
  const [state, setState] = useState(initialState);
  const [responding, setResponding] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  if (state === "self") return null;

  function run(next: FriendState, action: () => Promise<{ ok?: true; error?: string }>) {
    const previous = state;
    setState(next);
    setResponding(false);
    setConfirmingRemove(false);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setState(previous);
    });
  }

  if (state === "none") {
    return (
      <Button
        size="sm"
        disabled={!hydrated || pending}
        onClick={() => run("outgoing", () => sendFriendRequest(targetHandle))}
      >
        {pending ? "Sending…" : "Add friend"}
      </Button>
    );
  }

  if (state === "outgoing") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={!hydrated || pending}
        onClick={() => run("none", () => cancelFriendRequest(targetHandle))}
      >
        {pending ? "Canceling…" : "Requested"}
      </Button>
    );
  }

  if (state === "incoming") {
    if (!responding) {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={!hydrated || pending}
          onClick={() => setResponding(true)}
        >
          Respond
        </Button>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!hydrated || pending}
          onClick={() => run("friends", () => acceptFriendRequest(targetHandle))}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!hydrated || pending}
          onClick={() => run("none", () => declineFriendRequest(targetHandle))}
        >
          Decline
        </Button>
      </div>
    );
  }

  if (!confirmingRemove) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={!hydrated || pending}
        onClick={() => setConfirmingRemove(true)}
      >
        Friends
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={!hydrated || pending}
        onClick={() => setConfirmingRemove(false)}
      >
        Keep
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={!hydrated || pending}
        onClick={() => run("none", () => removeFriendAction(targetHandle))}
      >
        Remove
      </Button>
    </div>
  );
}
