"use client";

import { Lock, Users, Globe, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { setVisibility } from "@/app/flights/[id]/visibility-action";
import { FLIGHT_VISIBILITIES, type FlightVisibility } from "@/lib/flights/visibility";

const ICONS: Record<FlightVisibility, LucideIcon> = {
  private: Lock,
  friends: Users,
  public: Globe,
};

const LABELS: Record<FlightVisibility, string> = {
  private: "Private — only you can see this flight",
  friends: "Friends only — visible to pilots you're friends with",
  public: "Public — anyone with the link can see this flight",
};

/** Owner-only visibility button. Each click advances private → friends → public. */
export function ShareToggle({ flightId, visibility }: { flightId: string; visibility: FlightVisibility }) {
  const [current, setCurrent] = useState(visibility);
  const [pending, startTransition] = useTransition();
  const Icon = ICONS[current];
  const next = FLIGHT_VISIBILITIES[(FLIGHT_VISIBILITIES.indexOf(current) + 1) % FLIGHT_VISIBILITIES.length];
  const title = `${LABELS[current]} (click for ${next})`;

  function cycle() {
    if (pending) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setVisibility(flightId, next);
      if (!result.ok) setCurrent(previous);
    });
  }

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={pending}
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-ink disabled:opacity-60"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
