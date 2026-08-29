"use client";

import {
  Calendar,
  Clock,
  Mountain,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight,
  Route,
  ArrowLeftRight,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  formatDuration,
  formatAltitude,
  formatDistance,
  formatVario,
  formatLocalDate,
  formatLocalTime,
} from "@/lib/flights/format";
import { useUnits } from "@/lib/flights/use-units";
import { cn } from "@/lib/utils";
import type { Flight } from "@prisma/client";

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 basis-1/3 flex-col gap-1 p-4">
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0 text-amber" />
        <span className="font-condensed text-lg font-bold tabular-nums text-ink">{value}</span>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
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
    <div className="flex min-w-0 flex-1 basis-1/3 flex-col gap-1 p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <ArrowUpRight className="h-4 w-4 shrink-0 text-amber" />
          <span className="font-condensed text-lg font-bold tabular-nums text-ink">{climb}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowDownRight className="h-4 w-4 shrink-0 text-amber" />
          <span className="font-condensed text-lg font-bold tabular-nums text-ink">{sink}</span>
        </div>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        Best climb / max sink
      </span>
    </div>
  );
}

/**
 * Key-statistics card — an icon + value grid, three per row, with a
 * metric/imperial toggle. Replaces the old horizontal-scrolling tile strip.
 */
export function KeyStatistics({ flight }: { flight: Flight }) {
  const [units, changeUnits] = useUnits();

  const offset = flight.localUtcOffsetMinutes;
  const timeRange = `${formatLocalTime(flight.takeoffAt, offset)} – ${formatLocalTime(flight.landingAt, offset)}`;

  const row1: [string, LucideIcon, string][] = [
    [
      "Date",
      Calendar,
      formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.localUtcOffsetMinutes),
    ],
    ["Start – End", Clock, timeRange],
    ["Wing", Triangle, flight.glider ?? "—"],
  ];
  const row2: [string, LucideIcon, string][] = [
    ["Airtime", Clock, formatDuration(flight.durationS)],
    ["Distance", Route, formatDistance(flight.trackDistM, units)],
    ["Straight line", ArrowLeftRight, formatDistance(flight.straightDistM, units)],
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          Key statistics
        </span>
        <div className="inline-flex rounded-md border border-gray-200 p-0.5">
          {(["metric", "imperial"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => changeUnits(u)}
              className={cn(
                "rounded px-2.5 py-1 font-condensed text-xs font-bold capitalize transition-colors",
                units === u ? "bg-ink text-paper" : "text-gray-600 hover:text-ink",
              )}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        <div className="flex divide-x divide-gray-100">
          {row1.map(([label, Icon, value]) => (
            <Stat key={label} label={label} icon={Icon} value={value} />
          ))}
        </div>
        <div className="flex divide-x divide-gray-100">
          {row2.map(([label, Icon, value]) => (
            <Stat key={label} label={label} icon={Icon} value={value} />
          ))}
        </div>
        <div className="flex divide-x divide-gray-100">
          <Stat label="Max altitude" icon={Mountain} value={formatAltitude(flight.maxAltM, units)} />
          <Stat label="Height gained" icon={ArrowUp} value={formatAltitude(flight.altGainM, units)} />
          <ClimbSinkStat
            climb={formatVario(flight.maxClimbMs, units)}
            sink={formatVario(flight.maxSinkMs, units)}
          />
        </div>
      </div>
    </Card>
  );
}
