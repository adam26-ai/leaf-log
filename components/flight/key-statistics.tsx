"use client";

import { useState } from "react";
import {
  Calendar,
  Clock,
  Mountain,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight,
  Route,
  ArrowLeftRight,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  formatDuration,
  formatAltitude,
  formatDistance,
  formatVario,
  formatLocalDate,
  type UnitSystem,
} from "@/lib/flights/format";
import { formatLocationLabel } from "@/lib/sites/display";
import { cn } from "@/lib/utils";
import type { Flight } from "@prisma/client";

const UNITS_KEY = "leaf-units";

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

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

/**
 * Key-statistics card — an icon + value grid, three per row, with a
 * metric/imperial toggle. Replaces the old horizontal-scrolling tile strip.
 */
export function KeyStatistics({ flight }: { flight: Flight }) {
  const [units, setUnits] = useState<UnitSystem>(() => {
    if (typeof window === "undefined") return "metric";
    return localStorage.getItem(UNITS_KEY) === "imperial" ? "imperial" : "metric";
  });

  function changeUnits(next: UnitSystem) {
    setUnits(next);
    try {
      localStorage.setItem(UNITS_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const location =
    formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site";

  const stats: [string, LucideIcon, string][] = [
    [
      "Date",
      Calendar,
      formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.localUtcOffsetMinutes),
    ],
    ["Airtime", Clock, formatDuration(flight.durationS)],
    ["Max altitude", Mountain, formatAltitude(flight.maxAltM, units)],
    ["Height gained", ArrowUp, formatAltitude(flight.altGainM, units)],
    ["Best climb", ArrowUpRight, formatVario(flight.maxClimbMs, units)],
    ["Strongest sink", ArrowDownRight, formatVario(flight.maxSinkMs, units)],
    ["Track distance", Route, formatDistance(flight.trackDistM, units)],
    ["Straight line", ArrowLeftRight, formatDistance(flight.straightDistM, units)],
    ["Location", MapPin, location],
  ];
  const rows = chunk(stats, 3);

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
        {rows.map((row, i) => (
          <div key={i} className="flex divide-x divide-gray-100">
            {row.map(([label, Icon, value]) => (
              <Stat key={label} label={label} icon={Icon} value={value} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
