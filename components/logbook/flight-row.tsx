"use client";

import Link from "next/link";
import Image from "next/image";
import { Monitor, ThumbsUp, Globe, Lock, Users, NotebookPen, FileSpreadsheet, Cloud } from "lucide-react";
import type { FlightTrophy } from "@/lib/flights/trophies";
import { WingPairIcon } from "@/components/icons/wing-icon";
import { useFeedLayout } from "./feed-layout-provider";
import { trophyGroups } from "@/lib/flights/trophy-groups";
import { TrophyPill } from "./trophy-pill";
import { ResponsiveTrophies } from "./responsive-trophies";
import {
  formatDuration,
  formatAltitude,
  formatLocalDate,
  formatLocalDateShort,
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
  isOwner = false,
  kudoCount,
  compact = false,
  highlightScore = 0,
  distanceScore = 0,
  previewAutoUpload = false,
  trophies,
  showAnalysis = false,
  friendFlightsFound = false,
  prioritizeSiteOnMobile = false,
  feedLayout = false,
}: {
  flight: FlightListItem;
  owner?: FlightRowOwner;
  isOwner?: boolean;
  kudoCount?: number;
  compact?: boolean;
  highlightScore?: number;
  distanceScore?: number;
  previewAutoUpload?: boolean;
  trophies?: FlightTrophy[];
  showAnalysis?: boolean;
  friendFlightsFound?: boolean;
  prioritizeSiteOnMobile?: boolean;
  feedLayout?: boolean;
}) {
  const { units } = useUnits();
  const layout = useFeedLayout(trophies ?? []);
  const visibility =
    flight.visibility === "public"
      ? { label: "Public", className: "border-white bg-success-accent text-gray-800" }
      : flight.visibility === "friends"
        ? { label: "Friends", className: "border-brand-blue bg-brand-blue/10 text-brand-blue-strong" }
        : { label: "Private", className: "border-gray-400 bg-white text-gray-600" };
  const VisibilityIcon = flight.visibility === "public" ? Globe : flight.visibility === "friends" ? Users : Lock;
  const site = formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName)
    ?? formatLocationLabel(flight.landingSiteName, flight.landingZoneName)
    ?? (flight.takeoffSiteAssignment === "needs_review" ? "Choose site" : "Unknown site");
  if (compact) {
    const blueAlpha = Math.min(1, Math.max(0, highlightScore)) * 0.22;
    const greenAlpha = Math.min(1, Math.max(0, distanceScore)) * 0.38;
    const blue = `rgb(0 153 255 / ${blueAlpha})`;
    const green = `rgb(148 233 30 / ${greenAlpha})`;
    const landing = formatLocationLabel(flight.landingSiteName, flight.landingZoneName)
      ?? (isOwner && flight.landingSiteAssignment === "needs_review" ? "Choose site" : null);
    const showLanding = (flight.takeoffSiteName || !flight.landingSiteName) && landing && (flight.landingSiteAssignment === "needs_review" || flight.landingSiteId !== flight.takeoffSiteId
      || flight.landingZoneId !== flight.takeoffZoneId || landing !== site);
    if (feedLayout) {
      const groups = trophyGroups(trophies ?? [], layout.slots);
      const expandText = layout.combinedBadges && !friendFlightsFound && !groups.length;
      const friendBadge = friendFlightsFound && <span title="You flew together" aria-label="You flew together" className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-full border border-brand-blue bg-brand-blue text-white"><WingPairIcon aria-hidden="true" className="h-6 w-6" /></span>;
      const trophyBadges = !!groups.length && <span aria-label="Flight trophies" className="flex gap-1">{groups.map(group => <TrophyPill key={group.map(t => t.category).join(',')} trophies={group} compact={layout.compactTrophies} />)}</span>;
      return (
        <Link href={`/flights/${flight.id}`} data-feed-card-width={Math.round(layout.width)}
          className="grid min-h-[45px] items-center rounded-md border border-gray-200 py-1 text-xs transition-colors hover:bg-gray-50"
          style={{ backgroundImage: `linear-gradient(to right, ${blue}, ${green})`, gridTemplateColumns: layout.columns, columnGap: layout.gap, paddingLeft: layout.padding, paddingRight: layout.padding }}>
          <span data-feed-column="date" className={`min-w-0 text-gray-600${layout.stacked ? " truncate" : ""}`} style={{ gridColumn: expandText ? '1 / -1' : 1, gridRow: layout.stacked ? 2 : 1, fontSize: 13, lineHeight: '16px' }}>
            <span className={layout.stacked ? "font-bold" : "block font-bold"}>{formatLocalDateShort(flight.takeoffAt ?? flight.flightDate, flight.takeoffAt ? flight.localUtcOffsetMinutes : 0)}</span>
            {layout.stacked && " \u00b7 "}
            <span className={layout.stacked ? "tabular-nums" : "block whitespace-nowrap tabular-nums"}>{formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} &middot; {formatDuration(flight.durationS)}</span>
          </span>
          <span data-feed-column="site" title={showLanding ? `${site} \u2192 ${landing}` : site} className={`min-w-0${layout.stacked ? " flex flex-wrap items-baseline gap-x-1.5" : ""}`} style={{ gridColumn: expandText ? '1 / -1' : layout.stacked ? 1 : 2, gridRow: 1 }}>
            <span className="block max-w-full truncate font-condensed font-bold leading-4 text-ink" style={{ fontSize: 16 }}>{site}</span>
            {showLanding && <span title={`Landing: ${landing}`} className="block max-w-full truncate text-xs leading-4 text-gray-600">&rarr; {landing}</span>}
          </span>
          {layout.altitude && <span title="Maximum altitude" className="flex min-w-0 items-center gap-1 whitespace-nowrap tabular-nums text-brand-blue-strong" style={{gridColumn: layout.stacked ? 2 : 3, gridRow: layout.stacked ? '1 / span 2' : 1}}><Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{flight.status === "failed" ? "Unreadable" : formatAltitude(flight.maxAltM, units)}</span>}
          {layout.combinedBadges ? !expandText && <span data-feed-column="badges" className="flex min-w-0 flex-nowrap items-center justify-end gap-1" style={{ gridColumn: 2, gridRow: '1 / span 2' }}>
            {friendBadge && <span data-feed-column="friends" className="flex shrink-0 justify-center">{friendBadge}</span>}
            {trophyBadges && <span data-feed-column="trophies" className="flex shrink-0 justify-center">{trophyBadges}</span>}
          </span> : <>
            <span data-feed-column="friends" className="flex items-center justify-center" style={{gridColumn: (layout.stacked ? 2 : 3) + Number(layout.altitude), gridRow: layout.stacked ? '1 / span 2' : 1}}>{friendBadge}</span>
            {layout.hasTrophies && <span data-feed-column="trophies" className="min-w-0" style={{gridColumn: (layout.stacked ? 3 : 4) + Number(layout.altitude), gridRow: layout.stacked ? '1 / span 2' : 1}}>{trophyBadges}</span>}
          </>}
          {layout.upload && <span className="inline-flex" style={{gridColumn: layout.hasTrophies ? 6 : 5, gridRow: 1}}><UploadSource source={flight.source} /></span>}
        </Link>
      );
    }
    return (
      <div className="relative">
      <Link href={`/flights/${flight.id}`} style={{ backgroundImage: blueAlpha > 0 && greenAlpha > 0 ? `linear-gradient(to right, ${blue}, ${green})` : undefined, backgroundColor: blueAlpha > 0 && greenAlpha > 0 ? undefined : blueAlpha > 0 ? blue : green }}
        className={`grid min-h-[45px] items-center gap-1 rounded-md border border-gray-200 px-1 py-1 text-xs transition-colors hover:bg-gray-50 sm:grid-cols-[8.5rem_minmax(10rem,1fr)_2.75rem_minmax(2.75rem,1.4fr)_auto] sm:gap-2 sm:px-3 sm:py-1 sm:text-sm ${prioritizeSiteOnMobile ? "grid-cols-[6rem_minmax(0,1fr)_2rem_1.5rem] min-[480px]:grid-cols-[7.5rem_minmax(0,1fr)_2.75rem_2.75rem_auto]" : "grid-cols-[7.5rem_minmax(0,1fr)_2.75rem_2.75rem] min-[400px]:grid-cols-[7.5rem_minmax(0,1fr)_2.75rem_2.75rem_auto]"}`}>
        <span className="min-w-0 text-gray-600"><span className="block whitespace-nowrap text-[13px] font-bold leading-4"><span className={prioritizeSiteOnMobile ? "sm:hidden" : "hidden"}>{formatLocalDateShort(flight.takeoffAt ?? flight.flightDate, flight.takeoffAt ? flight.localUtcOffsetMinutes : 0)}</span><span className={prioritizeSiteOnMobile ? "hidden sm:inline" : ""}>{formatLocalDate(flight.takeoffAt ?? flight.flightDate, flight.takeoffAt ? flight.localUtcOffsetMinutes : 0)}</span></span><span className="block whitespace-nowrap text-[13px] leading-4 tabular-nums">{formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} · {formatDuration(flight.durationS)}</span></span>
        <span className="flex min-w-0 items-center gap-2">
        <span title={showLanding ? `${site} → ${landing}` : site} className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
          <span className="block max-w-full truncate font-condensed text-base font-bold leading-4 text-ink">{site}</span>
          {showLanding && <span title={`Landing: ${landing}`} className="block max-w-full truncate text-xs leading-4 text-gray-600">→ {landing}</span>}
        </span>
          <span title="Maximum altitude" className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap tabular-nums text-brand-blue-strong sm:inline-flex"><Cloud className="h-3.5 w-3.5" aria-hidden="true" />{flight.status === "failed" ? "Unreadable" : formatAltitude(flight.maxAltM, units)}</span>
        </span>
        <span className="flex h-6 w-full shrink-0 items-center justify-center">
          {friendFlightsFound && <span title="You flew together" aria-label="You flew together" className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-full border border-brand-blue bg-brand-blue text-white"><WingPairIcon aria-hidden="true" className="h-6 w-6" /></span>}
        </span>
        <ResponsiveTrophies trophies={trophies ?? []} />
        <span className={`hidden items-center gap-1 sm:gap-3 ${prioritizeSiteOnMobile ? "min-[480px]:flex" : "min-[400px]:flex"}`}>
          <span title={`Visibility: ${visibility.label}`} aria-label={`Visibility: ${visibility.label}`} className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${visibility.className}`}><VisibilityIcon aria-hidden="true" className="h-[15px] w-[15px]" /></span>
          <UploadSource source={process.env.NODE_ENV === "development" && previewAutoUpload ? "device_push" : flight.source} />
        </span>
      </Link>
      {showAnalysis && <AnalysisStatus flight={flight} owner compact />}
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
          {site}
        </span>
        <span className="text-sm font-bold text-gray-500">
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
          <span title="Maximum altitude" className="hidden items-center gap-1 tabular-nums text-brand-blue-strong sm:inline-flex">
            <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
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
