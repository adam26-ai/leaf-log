"use client";

import {
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
} from "@/lib/flights/format";
import { useUnits } from "@/lib/flights/use-units";
import { cn } from "@/lib/utils";
import type { Flight } from "@prisma/client";

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-paper px-3 py-2.5">
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
    <div className="flex min-w-0 flex-col gap-0.5 bg-paper px-3 py-2.5">
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
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-gray-100 sm:grid-cols-4 lg:grid-cols-[repeat(6,minmax(0,1fr))_minmax(10rem,1.35fr)]">
        {statistics.map(([label, Icon, value]) => (
          <Stat key={label} label={label} icon={Icon} value={value} />
        ))}
        <ClimbSinkStat
          climb={formatVario(flight.maxClimbMs, units)}
          sink={formatVario(flight.maxSinkMs, units)}
        />
      </div>
    </Card>
  );
}

export function UnitToggle() {
  const [units, changeUnits] = useUnits();
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-paper p-0.5">
      {(["metric", "imperial"] as const).map((unit) => (
        <button
          key={unit}
          type="button"
          onClick={() => changeUnits(unit)}
          className={cn(
            "rounded px-2.5 py-1 font-condensed text-xs font-bold transition-colors",
            units === unit ? "bg-ink text-paper" : "text-gray-600 hover:text-ink",
          )}
        >
          {unit === "metric" ? "Metric" : "Imperial"}
        </button>
      ))}
    </div>
  );
}
