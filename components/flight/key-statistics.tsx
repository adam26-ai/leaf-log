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

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-amber" />
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
    </div>
  );
}

/** Best climb and strongest sink together in one cell — two readings that
 *  are naturally a pair, so they share a single label instead of eating two
 *  grid cells. */
function ClimbSinkStat({ climb, sink }: { climb: string; sink: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-amber" />
          <span className="whitespace-nowrap font-condensed text-base font-bold tabular-nums text-ink">
            {climb}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-amber" />
          <span className="whitespace-nowrap font-condensed text-base font-bold tabular-nums text-ink">
            {sink}
          </span>
        </div>
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
  const statistics: [string, LucideIcon, string][] = [
    ["Wing", Triangle, flight.glider ?? "—"],
    ["Airtime", Clock, formatDuration(flight.durationS)],
    ["Distance", Route, formatDistance(flight.trackDistM, units)],
    ["Straight line", ArrowLeftRight, formatDistance(flight.straightDistM, units)],
    ["Max altitude", Mountain, formatAltitude(flight.maxAltM, units)],
    ["Height gained", ArrowUp, formatAltitude(flight.altGainM, units)],
  ];

  return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 lg:grid-cols-[repeat(6,minmax(0,1fr))_minmax(10rem,1.35fr)_2.25rem]">
        {statistics.map(([label, Icon, value]) => (
          <Stat key={label} label={label} icon={Icon} value={value} />
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
          ? "border-amber bg-amber text-ink"
          : "border-gray-300 bg-paper text-gray-600 hover:border-gray-400 hover:text-ink",
      )}
    >
      <Ruler className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
