"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setVisibility } from "@/app/flights/[id]/visibility-action";

/**
 * Low-pressure sharing control (owner only). Private by default; one tap shares.
 * Encouraging copy, no leaderboard pressure.
 */
export function ShareToggle({
  flightId,
  visibility,
}: {
  flightId: string;
  visibility: "private" | "public";
}) {
  const [current, setCurrent] = useState(visibility);
  const [pending, startTransition] = useTransition();
  const isPublic = current === "public";

  function toggle() {
    const next = isPublic ? "private" : "public";
    startTransition(async () => {
      const res = await setVisibility(flightId, next);
      if (res.ok) setCurrent(next);
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-paper px-4 py-3">
      <div className="flex flex-col">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          {isPublic ? "Shared publicly" : "Private flight"}
        </span>
        <span className="text-xs text-gray-500">
          {isPublic
            ? "Anyone with the link can see this flight."
            : "Only you can see this. Share it when you're ready."}
        </span>
      </div>
      <Button
        onClick={toggle}
        disabled={pending}
        size="sm"
        variant={isPublic ? "outline" : "leaf"}
        className="ml-auto"
      >
        {pending ? "…" : isPublic ? "Make private" : "Share flight"}
      </Button>
    </div>
  );
}
