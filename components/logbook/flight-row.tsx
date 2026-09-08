"use client";

import Link from "next/link";
import { ThumbsUp } from "lucide-react";
import {
  formatDuration,
  formatAltitude,
  formatLocalDate,
  formatLocalTime,
} from "@/lib/flights/format";
import type { FlightListItem } from "@/lib/flights/repo";
import { formatLocationLabel } from "@/lib/sites/display";
import { Avatar } from "@/components/avatar";
import { useUnits } from "@/lib/flights/use-units";

interface FlightRowOwner {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
}

export function FlightRow({
  flight,
  owner,
  kudoCount,
  compact = false,
  highlightScore = 0,
  distanceScore = 0,
}: {
  flight: FlightListItem;
  owner?: FlightRowOwner;
  kudoCount?: number;
  compact?: boolean;
  highlightScore?: number;
  distanceScore?: number;
}) {
  const [units] = useUnits();
  const visibility =
    flight.visibility === "public"
      ? { label: "Public", className: "bg-leaf/15 text-leaf-strong" }
      : flight.visibility === "friends"
        ? { label: "Friends", className: "bg-brand-blue/15 text-brand-blue-strong" }
        : { label: "Private", className: "bg-gray-100 text-gray-500" };
  if (compact) {
    const blueAlpha = Math.min(1, Math.max(0, highlightScore)) * 0.22;
    const greenAlpha = Math.min(1, Math.max(0, distanceScore)) * 0.38;
    const blue = `rgb(0 153 255 / ${blueAlpha})`;
    const green = `rgb(148 233 30 / ${greenAlpha})`;
    const site = formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site";
    return (
      <Link
        href={`/flights/${flight.id}`}
        style={{
          backgroundImage: blueAlpha > 0 && greenAlpha > 0
            ? `linear-gradient(to right, ${blue}, ${green})`
            : undefined,
          backgroundColor: blueAlpha > 0 && greenAlpha > 0 ? undefined : blueAlpha > 0 ? blue : green,
        }}
        className="grid min-w-[700px] grid-cols-[10.5rem_3.5rem_4.5rem_minmax(8rem,1fr)_5.5rem_4.5rem] items-center gap-5 rounded-md border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-blue"
      >
        <span className="whitespace-nowrap text-gray-600">{formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.localUtcOffsetMinutes)}</span>
        <span className="tabular-nums text-gray-600">{formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)}</span>
        <span title="Duration" className="whitespace-nowrap tabular-nums text-gray-700">{formatDuration(flight.durationS)}</span>
        <span title={site} className="truncate font-condensed text-base font-bold text-ink">{site}</span>
        <span title="Maximum altitude" className="whitespace-nowrap text-right tabular-nums text-gray-700">
          {flight.status === "failed" ? "Unreadable" : formatAltitude(flight.maxAltM, units)}
        </span>
        <span className={`justify-self-end rounded-sm px-2 py-0.5 text-xs font-medium ${visibility.className}`}>{visibility.label}</span>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:bg-gray-50">
      {owner && (
        <Link
          href={`/@${owner.handle}`}
          className="flex min-w-0 shrink-0 items-center gap-2 text-sm text-gray-600 hover:text-ink"
        >
          <Avatar
            handle={owner.handle}
            displayName={owner.displayName}
            avatarUpdatedAt={owner.avatarUpdatedAt}
            className="h-9 w-9 text-xs"
          />
          <span className="hidden max-w-32 truncate font-mono text-xs sm:block">
            @{owner.handle}
          </span>
        </Link>
      )}
      <Link href={`/flights/${flight.id}`} className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-condensed text-lg font-bold text-ink hover:text-leaf-strong">
          {formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site"}
        </span>
        <span className="text-sm text-gray-500">
          {formatLocalDate(
            flight.takeoffAt ?? flight.flightDate,
            flight.localUtcOffsetMinutes,
          )}
        </span>
      </Link>
      {flight.status === "failed" ? (
        <span className="text-sm text-brand-blue-strong">Unreadable</span>
      ) : (
        <div className="flex items-center gap-4 text-sm text-gray-700 sm:gap-6">
          <span className="tabular-nums">{formatDuration(flight.durationS)}</span>
          <span className="hidden tabular-nums sm:inline">
            {formatAltitude(flight.maxAltM, units)}
          </span>
          {typeof kudoCount === "number" && (
            <span className="hidden items-center gap-1 tabular-nums text-gray-500 sm:inline-flex">
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
              {kudoCount}
            </span>
          )}
        </div>
      )}
      <span
        className={"rounded-sm px-2 py-0.5 text-xs font-medium " + visibility.className}
      >
        {visibility.label}
      </span>
    </div>
  );
}
