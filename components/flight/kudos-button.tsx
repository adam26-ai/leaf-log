"use client";

import { useState, useTransition } from "react";
import { ThumbsUp } from "lucide-react";
import { toggleKudoAction } from "@/app/flights/[id]/kudos-action";
import { cn } from "@/lib/utils";

function kudoLabel(count: number) {
  return count === 1 ? "1 kudos" : `${count} kudos`;
}

/** A small icon + count — not a card. Owners see it read-only (can't kudo
 *  their own flight); everyone else can tap it to toggle. */
export function KudosButton({
  flightId,
  initialCount,
  initialKudoed,
  canToggle,
  stacked = false,
}: {
  flightId: string;
  initialCount: number;
  initialKudoed: boolean;
  canToggle: boolean;
  stacked?: boolean;
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

  const content = (
    <>
      <ThumbsUp className={cn(stacked ? "h-5 w-5" : "h-4 w-4", "shrink-0", state.kudoed && "fill-brand-blue text-brand-blue-strong")} aria-hidden="true" />
      <span className="tabular-nums">{state.count}</span>
    </>
  );

  if (!canToggle) {
    return (
      <div
        className={cn("inline-flex items-center text-sm text-gray-600", stacked ? "w-full flex-col justify-center gap-0 text-center" : "gap-1.5")}
        title={kudoLabel(state.count)}
        aria-label={kudoLabel(state.count)}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={state.kudoed}
      aria-label={state.kudoed ? "Remove kudos" : "Give kudos"}
      title={kudoLabel(state.count)}
      onClick={toggle}
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-1 text-sm font-medium transition-colors hover:bg-gray-100 disabled:opacity-60",
        stacked ? "w-full flex-col justify-center gap-0 text-center" : "gap-1.5",
        state.kudoed ? "text-brand-blue-strong" : "text-gray-600 hover:text-ink",
      )}
    >
      {content}
    </button>
  );
}
