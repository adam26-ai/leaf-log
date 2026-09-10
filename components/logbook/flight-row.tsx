"use client";

import Link from "next/link";
import Image from "next/image";
import { Monitor, ThumbsUp, Globe, Lock, Users, NotebookPen, FileSpreadsheet, ArrowUp, Eye } from "lucide-react";
import type { FlightTrophy } from "@/lib/flights/trophies";
import { WingIcon } from "@/components/icons/wing-icon";
import { ResponsiveTrophies } from "./responsive-trophies";
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
import { AnalysisStatus } from "@/components/flight/analysis-status";

interface FlightRowOwner {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
}

function UploadSource({ source }: { source: string }) {
  const automatic = source === "device_push";
  const label = automatic ? "Auto-uploaded from Leaf" : source === "manual_entry" ? "Manual logbook entry" : source === "csv_import" ? "Imported logbook entry" : "Manually uploaded";
  const Icon = source === "manual_entry" ? NotebookPen : source === "csv_import" ? FileSpreadsheet : Monitor;
  return <span title={label} role="img" aria-label={label} className="grid h-6 w-6 sm:h-8 sm:w-8 shrink-0 place-items-center justify-self-end">
    {automatic
      ? <Image src="/leaf-auto-upload-transparent.png" alt="" width={32} height={32} className="h-6 w-6 sm:h-8 sm:w-8" />
      : <Icon aria-hidden="true" className="h-5 w-5 text-gray-500" />}
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
  showAnalysis = false,
  friendFlightsFound = false,
}: {
  flight: FlightListItem;
  owner?: FlightRowOwner;
  kudoCount?: number;
  compact?: boolean;
  highlightScore?: number;
  distanceScore?: number;
  previewAutoUpload?: boolean;
  trophies?: FlightTrophy[];
  showAnalysis?: boolean;
  friendFlightsFound?: boolean;
}) {
  const { units } = useUnits();
  const visibility =
    flight.visibility === "public"
      ? { label: "Public", className: "border-white bg-success-accent text-gray-800" }
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
    const landing = formatLocationLabel(flight.landingSiteName, flight.landingZoneName);
    const showLanding = landing && (flight.landingSiteId !== flight.takeoffSiteId
      || flight.landingZoneId !== flight.takeoffZoneId || landing !== site);
    return (
      <div className="relative">
      <Link href={`/flights/${flight.id}`} style={{ backgroundImage: blueAlpha > 0 && greenAlpha > 0 ? `linear-gradient(to right, ${blue}, ${green})` : undefined, backgroundColor: blueAlpha > 0 && greenAlpha > 0 ? undefined : blueAlpha > 0 ? blue : green }}
        className="grid min-h-[45px] grid-cols-[7.5rem_minmax(0,1fr)_2.75rem_2.75rem] items-center gap-1 rounded-md border border-gray-200 px-1 py-1 text-xs transition-colors hover:bg-gray-50 min-[400px]:grid-cols-[7.5rem_minmax(0,1fr)_2.75rem_2.75rem_auto] sm:grid-cols-[8.5rem_minmax(10rem,1fr)_2.75rem_minmax(2.75rem,1.4fr)_auto] sm:gap-2 sm:px-3 sm:py-1 sm:text-sm">
        <span className="min-w-0 text-gray-600"><span className="block whitespace-nowrap text-[13px] leading-4">{formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.takeoffAt ? flight.localUtcOffsetMinutes : 0)}</span><span className="block whitespace-nowrap text-[13px] leading-4 tabular-nums">{formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} · {formatDuration(flight.durationS)}</span></span>
        <span className="flex min-w-0 items-center gap-2">
        <span title={showLanding ? `${site} → ${landing}` : site} className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
          <span className="block max-w-full truncate font-condensed text-base font-bold leading-4 text-ink">{site}</span>
          {showLanding && <span title={`Landing: ${landing}`} className="block max-w-full truncate text-xs leading-4 text-gray-600">→ {landing}</span>}
        </span>
          <span title="Maximum altitude" className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap tabular-nums text-gray-700 sm:inline-flex"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />{flight.status === "failed" ? "Unreadable" : formatAltitude(flight.maxAltM, units)}</span>
        </span>
        <span className="flex h-6 w-11 shrink-0 items-center justify-center">
          {friendFlightsFound && <span title="Friend flights found" aria-label="Friend flights found" className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full border border-brand-blue bg-brand-blue px-1.5 text-white"><WingIcon aria-hidden="true" className="h-4 w-4" /><Users aria-hidden="true" className="h-3.5 w-3.5" /></span>}
        </span>
        <ResponsiveTrophies trophies={trophies ?? []} />
        <span className="hidden items-center gap-1 min-[400px]:flex sm:gap-3">
          <span title={`Visibility: ${visibility.label}`} aria-label={`Visibility: ${visibility.label}`} className={`inline-flex h-6 items-center justify-center gap-0.5 rounded-full border px-1.5 ${visibility.className}`}><Eye aria-hidden="true" className="h-3.5 w-3.5" /><VisibilityIcon aria-hidden="true" className="h-3.5 w-3.5" /></span>
          <UploadSource source={process.env.NODE_ENV === "development" && previewAutoUpload ? "device_push" : flight.source} />
        </span>
      </Link>
      {showAnalysis && <div className="mt-1 flex justify-end empty:hidden"><AnalysisStatus flight={flight} owner compact /></div>}
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
        <span className="truncate font-condensed text-lg font-bold text-ink hover:text-brand-blue-strong">
          {formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site"}
        </span>
        <span className="text-sm text-gray-500">
          {formatLocalDate(
            flight.takeoffAt ?? flight.flightDate,
            flight.takeoffAt ? flight.localUtcOffsetMinutes : 0,
          )}
        </span>
      </Link>
      {flight.status === "failed" ? (
        <span className="text-sm text-brand-blue-strong">Unreadable</span>
      ) : (
        <div className="flex items-center gap-4 text-sm text-gray-700 sm:gap-6">
          <span className="tabular-nums">{formatDuration(flight.durationS)}</span>
          <span title="Maximum altitude" className="hidden items-center gap-1 tabular-nums sm:inline-flex">
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
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
