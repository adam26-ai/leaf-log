"use client";

import {
  Clock,
  Mountain,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight,
  Route,
  ArrowLeftRight,
  Ruler,
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
import { cn } from "@/lib/utils";
import type { Flight } from "@prisma/client";
import { seekReplayToMetric, type ReplayMetric } from "@/lib/flights/replay-events";

function Stat({ icon: Icon, label, value, seek }: { icon: LucideIcon; label: string; value: string; seek?: ReplayMetric }) {
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
  return seek ? (
    <button
      type="button"
      onClick={() => seekReplayToMetric(seek)}
      title={`Go to ${label.toLowerCase()}`}
      className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-100"
    >
      {content}
    </button>
  ) : <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">{content}</div>;
}

/** Best climb and strongest sink together in one cell — two readings that
 *  are naturally a pair, so they share a single label instead of eating two
 *  grid cells. */
function ClimbSinkStat({ climb, sink }: { climb: string; sink: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => seekReplayToMetric("best-climb")} title="Go to best climb" className="flex items-center gap-1.5 rounded-md transition-colors hover:bg-gray-100">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--replay-metric-icon-bg)]">
            <ArrowUpRight className="h-3.5 w-3.5 text-[var(--replay-icon)] [stroke-width:var(--replay-metric-icon-stroke)]" />
          </span>
          <span className="whitespace-nowrap font-condensed text-base font-bold tabular-nums text-ink">
            {climb}
          </span>
        </button>
        <button type="button" onClick={() => seekReplayToMetric("max-sink")} title="Go to max sink" className="flex items-center gap-1.5 rounded-md transition-colors hover:bg-gray-100">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--replay-metric-icon-bg)]">
            <ArrowDownRight className="h-3.5 w-3.5 text-[var(--replay-icon)] [stroke-width:var(--replay-metric-icon-stroke)]" />
          </span>
          <span className="whitespace-nowrap font-condensed text-base font-bold tabular-nums text-ink">
            {sink}
          </span>
        </button>
      </div>
      <span className="truncate whitespace-nowrap text-[9px] font-medium uppercase tracking-wide text-gray-500">
        Best climb / max sink
      </span>
    </div>
  );
}

/** Compact statistics strip: one row on desktop and a small grid on narrow screens. */
export function KeyStatistics({ flight }: { flight: Flight }) {
  const [units] = useUnits();
  const statistics: [string, LucideIcon, string, ReplayMetric?][] = [
    ["Wing", Triangle, flight.glider ?? "—"],
    ["Airtime", Clock, formatDuration(flight.durationS)],
    ["Distance", Route, formatDistance(flight.trackDistM, units)],
    ["Straight line", ArrowLeftRight, formatDistance(flight.straightDistM, units)],
    ["Max altitude", Mountain, formatAltitude(flight.maxAltM, units), "max-altitude"],
    ["Height gained", ArrowUp, formatAltitude(flight.altGainM, units)],
  ];

  return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 lg:grid-cols-[repeat(6,minmax(0,1fr))_minmax(10rem,1.35fr)_2.25rem]">
        {statistics.map(([label, Icon, value, seek]) => (
          <Stat key={label} label={label} icon={Icon} value={value} seek={seek} />
        ))}
        <ClimbSinkStat
          climb={formatVario(flight.maxClimbMs, units)}
          sink={formatVario(flight.maxSinkMs, units)}
        />
        <UnitToggle />
    </div>
  );
}

function UnitToggle() {
  const [units, changeUnits] = useUnits();
  const metric = units === "metric";
  return (
    <button
      type="button"
      aria-pressed={metric}
      aria-label={`${metric ? "Metric" : "Imperial"} units (click for ${metric ? "Imperial" : "Metric"})`}
      title={`${metric ? "Metric" : "Imperial"} units (click for ${metric ? "Imperial" : "Metric"})`}
      onClick={() => changeUnits(metric ? "imperial" : "metric")}
      className={cn(
        "grid h-9 w-9 place-items-center self-center justify-self-center rounded-md border p-0 shadow-sm transition-colors",
        metric
          ? "border-[var(--replay-active-border)] [border-width:var(--replay-button-border-width)] bg-[var(--replay-active-bg)] text-[var(--replay-active-fg)]"
          : "border-[var(--replay-inactive-border)] [border-width:var(--replay-inactive-button-border-width)] bg-[var(--replay-inactive-bg)] text-[var(--replay-inactive-fg)] hover:brightness-95",
      )}
    >
      <Ruler
        className={cn(
          "h-4 w-4",
          metric
            ? "[stroke-width:var(--replay-button-icon-stroke)]"
            : "[stroke-width:var(--replay-inactive-button-icon-stroke)]",
        )}
        aria-hidden="true"
      />
    </button>
  );
}
