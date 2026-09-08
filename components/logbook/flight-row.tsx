"use client";

import Link from "next/link";
import Image from "next/image";
import { Monitor, ThumbsUp, Globe, Lock, Users } from "lucide-react";
import type { FlightTrophy } from "@/lib/flights/trophies";
import { TrophyPill } from "./trophy-pill";
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
import { CalculateXcButton } from "@/components/flight/calculate-xc-button";

interface FlightRowOwner {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
}

function UploadSource({ source }: { source: string }) {
  const automatic = source === "device_push";
  const label = automatic ? "Auto-uploaded from Leaf" : "Manually uploaded";
  return <span title={label} role="img" aria-label={label} className="grid h-6 w-6 sm:h-8 sm:w-8 shrink-0 place-items-center justify-self-end">
    {automatic
      ? <Image src="/leaf-auto-upload-transparent.png" alt="" width={32} height={32} className="h-6 w-6 sm:h-8 sm:w-8" />
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
  trophies,
}: {
  flight: FlightListItem;
  owner?: FlightRowOwner;
  kudoCount?: number;
  compact?: boolean;
  highlightScore?: number;
  distanceScore?: number;
  previewAutoUpload?: boolean;
  trophies?: FlightTrophy[];
}) {
  const [units] = useUnits();
  const visibility =
    flight.visibility === "public"
      ? { label: "Public", className: "border-white bg-[#d8ff00] text-gray-800" }
      : flight.visibility === "friends"
        ? { label: "Friends", className: "border-brand-blue bg-brand-blue/10 text-brand-blue-strong" }
        : { label: "Private", className: "border-gray-400 bg-white text-gray-600" };
  const VisibilityIcon = flight.visibility === "public" ? Globe : flight.visibility === "friends" ? Users : Lock;
  if (compact) {
    const blueAlpha = Math.min(1, Math.max(0, highlightScore)) * 0.22;
    const greenAlpha = Math.min(1, Math.max(0, distanceScore)) * 0.38;
    const blue = `rgb(0 153 255 / ${blueAlpha})`;
    const green = `rgb(148 233 30 / ${greenAlpha})`;
    const site = formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site";
    return (
      <div className="relative">
      <Link href={`/flights/${flight.id}`} style={{ backgroundImage: blueAlpha > 0 && greenAlpha > 0 ? `linear-gradient(to right, ${blue}, ${green})` : undefined, backgroundColor: blueAlpha > 0 && greenAlpha > 0 ? undefined : blueAlpha > 0 ? blue : green }}
        className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-1 rounded-md border border-gray-200 px-2 py-2 text-xs transition-colors hover:bg-gray-50 min-[400px]:grid-cols-[6rem_minmax(0,1fr)_auto_1.5rem_1.5rem] sm:grid-cols-[10rem_minmax(6rem,1fr)_4rem_3.5rem_4.5rem_2rem] sm:gap-3 sm:px-4 sm:text-sm">
        <span className="min-w-0 text-gray-600"><span className="block text-[10px] sm:text-xs">{formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.localUtcOffsetMinutes)}</span><span className="block whitespace-nowrap text-[10px] tabular-nums sm:text-xs">{formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} · {formatDuration(flight.durationS)}</span></span>
        <span title={site} className="min-w-0 truncate font-condensed text-sm font-bold text-ink sm:text-base">{site}{flight.xcStatus === "queued" && <span className="block text-[10px] font-normal text-gray-500">XC: Calculating…</span>}</span>
        <span title="Maximum altitude" className="hidden whitespace-nowrap tabular-nums text-gray-700 sm:block">{flight.status === "failed" ? "Unreadable" : formatAltitude(flight.maxAltM, units)}</span>
        <span className="flex justify-end">{trophies && <TrophyPill trophies={trophies} />}</span>
        <span title={visibility.label} aria-label={visibility.label} className={`hidden h-6 items-center justify-center rounded-full min-[400px]:inline-flex sm:border sm:px-2 ${visibility.className}`}><VisibilityIcon className="h-3.5 w-3.5 sm:hidden" /><span className="hidden sm:inline">{visibility.label}</span></span>
        <span className="hidden min-[400px]:block"><UploadSource source={process.env.NODE_ENV === "development" && previewAutoUpload ? "device_push" : flight.source} /></span>
      </Link>
      {trophies !== undefined && flight.status === "ready" && ["unscored", "failed"].includes(flight.xcStatus) && <div className="mt-1 flex justify-end text-xs"><CalculateXcButton flightId={flight.id} /></div>}
      </div>
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
