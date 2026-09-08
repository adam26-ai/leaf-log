"use client";

import {
  Clock,
  Mountain,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight,
  TriangleRight,
  Waypoints,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import {
  formatDuration,
  formatAltitude,
  formatDistance,
  formatVario,
} from "@/lib/flights/format";
import { useUnits } from "@/lib/flights/use-units";
import type { Flight } from "@prisma/client";
import { seekReplayToMetric, toggleReplayXcRoute, type ReplayMetric } from "@/lib/flights/replay-events";
import { readXcScore } from "@/lib/igc/xc-types";
import { XcPendingRefresh } from "./xc-pending-refresh";
import { CalculateXcButton } from "./calculate-xc-button";

function Stat({ icon: Icon, label, value, seek, description, onClick }: { icon: LucideIcon; label: string; value: string; seek?: ReplayMetric; description?: string; onClick?: () => void }) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--replay-metric-icon-bg)]">
          <Icon className="h-3.5 w-3.5 text-[var(--replay-icon)] [stroke-width:var(--replay-metric-icon-stroke)]" />
        </span>
        <span
          className="truncate whitespace-nowrap font-condensed text-base font-bold tabular-nums text-ink"
          title={value}
        >
          {value}
        </span>
      </div>
      <span className="truncate whitespace-nowrap text-[9px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
    </>
  );
  return seek || onClick ? (
    <button
      type="button"
      onClick={onClick ?? (() => seek && seekReplayToMetric(seek))}
      title={description ?? `Go to ${label.toLowerCase()}`}
      className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-100"
    >
      {content}
    </button>
  ) : <div title={description} className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">{content}</div>;
}

/** Compact statistics strip: one row on desktop and a small grid on narrow screens. */
export function KeyStatistics({ flight, canCalculateXc = false }: { flight: Flight; canCalculateXc?: boolean }) {
  const [units] = useUnits();
  const xc = readXcScore(flight.xcScore);
  const xcIcon = xc?.best.shape === "fai-triangle" ? Triangle : xc?.best.shape === "free-triangle" ? TriangleRight : Waypoints;
  const xcLabel = xc ? `${xc.approximate ? "≈ " : ""}${xc.best.name}` : "XC distance";
  const statistics: [string, LucideIcon, string, ReplayMetric?][] = [
    ["Wing", Triangle, flight.glider ?? "—"],
    ["Airtime", Clock, formatDuration(flight.durationS)],
    [xcLabel, xcIcon, flight.xcStatus === "queued" ? "Calculating…" : formatDistance(xc?.best.distanceM ?? null, units)],
    ["Max altitude", Mountain, formatAltitude(flight.maxAltM, units), "max-altitude"],
    ["Height gained", ArrowUp, formatAltitude(flight.altGainM, units)],
    ["Best climb", ArrowUpRight, formatVario(flight.maxClimbMs, units), "best-climb"],
    ["Max sink", ArrowDownRight, formatVario(flight.maxSinkMs, units), "max-sink"],
  ];

  return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 lg:grid-cols-7">
        <XcPendingRefresh pending={flight.xcStatus === "queued"} />
        {statistics.map(([label, Icon, value, seek]) => (
          label === xcLabel && canCalculateXc && flight.status === "ready" && ["unscored", "failed"].includes(flight.xcStatus)
          ? <div key={label} className="self-center px-2"><CalculateXcButton flightId={flight.id} /></div> :
          <Stat key={label} label={label} icon={Icon} value={value} seek={seek}
            onClick={label === xcLabel && xc ? toggleReplayXcRoute : undefined}
            description={label === xcLabel ? xc
              ? `${xc.best.name}: ${formatDistance(xc.best.distanceM, units)} credited distance, ${xc.best.points.toFixed(2)} XContest points.${xc.approximate ? " Best found within the search time limit; a longer search may improve it." : " Optimal route found."} Click to show or hide the scored route.`
              : flight.xcStatus === "queued" ? "XC scoring is queued or calculating. You can replay the flight now."
              : "XC distance is unavailable. Reprocess this flight to calculate it."
              : undefined} />
        ))}
    </div>
  );
}
