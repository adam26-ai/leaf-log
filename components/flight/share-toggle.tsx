"use client";

import { useState, useTransition } from "react";
import { setVisibility } from "@/app/flights/[id]/visibility-action";
import {
  FLIGHT_VISIBILITIES,
  type FlightVisibility,
} from "@/lib/flights/visibility";

const LABELS: Record<FlightVisibility, { title: string; hint: string }> = {
  private: {
    title: "Private",
    hint: "Only you can see this flight.",
  },
  friends: {
    title: "Friends only",
    hint: "Visible to pilots you're friends with.",
  },
  public: {
    title: "Public",
    hint: "Anyone with the link can see this flight.",
  },
};

/**
 * Low-pressure sharing control (owner only). Private by default; no leaderboard
 * pressure.
 */
export function ShareToggle({
  flightId,
  visibility,
}: {
  flightId: string;
  visibility: FlightVisibility;
}) {
  const [current, setCurrent] = useState(visibility);
  const [pending, startTransition] = useTransition();

  function choose(next: FlightVisibility) {
    if (next === current) return;
    startTransition(async () => {
      const res = await setVisibility(flightId, next);
      if (res.ok) setCurrent(next);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-paper px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Flight visibility
        </span>
        <span className="text-xs text-gray-500">{LABELS[current].hint}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-md bg-gray-100 p-1">
        {FLIGHT_VISIBILITIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            disabled={pending}
            aria-pressed={current === option}
            className={
              "h-8 rounded-sm px-2 font-condensed text-sm font-bold tracking-wide transition-colors disabled:opacity-60 " +
              (current === option
                ? "bg-paper text-ink shadow-sm"
                : "text-gray-600 hover:bg-paper/70")
            }
          >
            {LABELS[option].title}
          </button>
        ))}
      </div>
    </div>
  );
}
