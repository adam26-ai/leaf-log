"use client";

import Link from "next/link";
import Image from "next/image";
import { Monitor, ThumbsUp, Waypoints, Triangle, TriangleRight } from "lucide-react";
import type { XcBadge } from "@/lib/flights/xc-rankings";
import {
  formatDuration,
  formatDistance,
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

function UploadSource({ source }: { source: string }) {
  const automatic = source === "device_push";
  const label = automatic ? "Auto-uploaded from Leaf" : "Manually uploaded";
  return <span title={label} role="img" aria-label={label} className="grid h-8 w-8 shrink-0 place-items-center justify-self-end">
    {automatic
      ? <Image src="/leaf-auto-upload-transparent.png" alt="" width={32} height={32} className="h-8 w-8" />
      : <Monitor aria-hidden="true" className="h-5 w-5 text-gray-500" />}
  </span>;
}

export function FlightRow({
  flight,
  owner,
  kudoCount,
  compact = false,
  highlightScore = 0,
  distanceScore = 0,
  previewAutoUpload = false,
  xcBadges,
}: {
  flight: FlightListItem;
  owner?: FlightRowOwner;
  kudoCount?: number;
  compact?: boolean;
  highlightScore?: number;
  distanceScore?: number;
  previewAutoUpload?: boolean;
  xcBadges?: XcBadge[];
}) {
  const [units] = useUnits();
  const visibility =
    flight.visibility === "public"
      ? { label: "Public", className: "border-white bg-[#d8ff00] text-gray-800" }
      : flight.visibility === "friends"
        ? { label: "Friends", className: "border-brand-blue bg-brand-blue/10 text-brand-blue-strong" }
        : { label: "Private", className: "border-gray-400 bg-white text-gray-600" };
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
        className={`grid items-center rounded-md border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-blue ${xcBadges !== undefined
          ? "min-w-[800px] grid-cols-[9.5rem_3.25rem_4.5rem_minmax(6rem,1fr)_4rem_9rem_4.5rem_2rem] gap-3"
          : "min-w-[748px] grid-cols-[9.5rem_3.25rem_4.5rem_minmax(8rem,1fr)_5.5rem_4.5rem_2rem] gap-5"}`}
      >
        <span className="whitespace-nowrap text-gray-600">{formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.localUtcOffsetMinutes)}</span>
        <span className={`${xcBadges !== undefined ? "-ml-1" : "-ml-3"} whitespace-nowrap tabular-nums text-gray-600`}>{formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)}</span>
        <span title="Duration" className="whitespace-nowrap text-right tabular-nums text-gray-700">{formatDuration(flight.durationS)}</span>
        <span title={site} className="truncate font-condensed text-base font-bold text-ink">{site}</span>
        <span title="Maximum altitude" className="whitespace-nowrap text-left tabular-nums text-gray-700">
          {flight.status === "failed" ? "Unreadable" : formatAltitude(flight.maxAltM, units)}
        </span>
        {xcBadges !== undefined && <span className="grid grid-cols-3 items-center gap-1" aria-label="Personal top 10 XC rankings">
          {(["open", "fai-triangle", "free-triangle"] as const).map(shape => {
            const badge = xcBadges.find(b => b.shape === shape);
            if (!badge) return <span key={shape} aria-hidden="true" />;
            const Icon = badge.shape === "open" ? Waypoints : badge.shape === "fai-triangle" ? Triangle : TriangleRight;
            const name = badge.shape === "open" ? "Open distance" : badge.shape === "fai-triangle" ? "FAI triangle" : "Free triangle";
            const label = `${name}: #${badge.rank} in your logbook — ${formatDistance(badge.distanceM, units)}${badge.approximate ? " (best found; search may improve)" : ""}`;
            return <span key={badge.shape} title={label} aria-label={label} className="inline-flex h-6 items-center justify-center gap-1 rounded-full border border-brand-blue/40 bg-white/75 text-xs font-semibold tabular-nums text-brand-blue-strong">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{badge.rank}
            </span>;
          })}
        </span>}
        <span className={`inline-flex h-6 w-[4.5rem] shrink-0 items-center justify-center justify-self-end rounded-full border text-xs font-medium ${visibility.className}`}>{visibility.label}</span>
        <UploadSource source={process.env.NODE_ENV === "development" && previewAutoUpload ? "device_push" : flight.source} />
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
        className={"inline-flex h-6 w-[4.5rem] shrink-0 items-center justify-center rounded-full border text-xs font-medium " + visibility.className}
      >
        {visibility.label}
      </span>
      <UploadSource source={flight.source} />
    </div>
  );
}
