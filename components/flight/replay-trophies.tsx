"use client";
import { TrophyPill } from "@/components/logbook/trophy-pill";
import type { FlightTrophy } from "@/lib/flights/trophies";
import type { XcShape } from "@/lib/igc/xc-types";
import { selectReplayXcRoute } from "@/lib/flights/replay-events";

export function ReplayTrophies({ flightId, trophies, routes }: { flightId: string; trophies: FlightTrophy[]; routes: XcShape[] }) {
  return <div className="flex flex-wrap items-center justify-center gap-1">{trophies.map(trophy => <TrophyPill key={trophy.category} trophies={[trophy]}
    onActivate={routes.includes(trophy.category as XcShape) ? () => selectReplayXcRoute(flightId, trophy.category as XcShape) : undefined} />)}</div>;
}
