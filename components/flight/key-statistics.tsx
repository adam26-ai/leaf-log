"use client";

import {
  Clock,
  Mountain,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import {
  formatDuration,
  formatAltitude,
  formatVario,
} from "@/lib/flights/format";
import { useUnits } from "@/lib/flights/use-units";
import type { CSSProperties } from "react";
import type { FlightStatistics } from "@/lib/flights/statistics";
import { seekReplayToMetric, type ReplayMetric } from "@/lib/flights/replay-events";
import { XcPendingRefresh } from "./xc-pending-refresh";
import { XcStatistic } from "./xc-statistic";
import { analysisPending } from "@/lib/flights/analysis-state";
import { WingIcon } from "@/components/icons/wing-icon";

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
export function KeyStatistics({ flight, canCalculateXc = false, friend = false, onRefresh }: {
  flight: FlightStatistics;
  canCalculateXc?: boolean;
  friend?: boolean;
  onRefresh?: () => void;
}) {
  const { units } = useUnits();
  const statistics: [string, LucideIcon, string, ReplayMetric?][] = [
    ["Wing", WingIcon, flight.glider ?? "—"],
    ["Airtime", Clock, formatDuration(flight.durationS)],
    ["XC distance", Waypoints, ""],
    ["Max altitude", Mountain, formatAltitude(flight.maxAltM, units), "max-altitude"],
    ["Height gained", ArrowUp, formatAltitude(flight.altGainM, units)],
    ["Best climb", ArrowUpRight, formatVario(flight.maxClimbMs, units), "best-climb"],
    ["Max sink", ArrowDownRight, formatVario(flight.maxSinkMs, units), "max-sink"],
  ];

  return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 lg:grid-cols-7"
        data-statistics-flight={flight.id} data-statistics-pilot={friend ? "friend" : "own"}
        style={friend ? { "--replay-icon": "var(--replay-group-companion)" } as CSSProperties : undefined}>
        <XcPendingRefresh pending={analysisPending(flight.xcStatus)} onRefresh={onRefresh} />
        {statistics.map(([label, Icon, value, seek]) => (
          label === "XC distance" ? <XcStatistic key={flight.id} flight={flight} owner={canCalculateXc} onRefresh={onRefresh} /> :
          <Stat key={label} label={label} icon={Icon} value={value} seek={seek} />
        ))}
    </div>
  );
}
