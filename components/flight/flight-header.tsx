import { AccentBar } from "@/components/ui/accent-bar";
import { SiteNameControl } from "@/components/flight/name-site-dialog";
import { zonesEnabled } from "@/lib/sites/zones-enabled";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { formatLocalDate, formatLocalTime } from "@/lib/flights/format";
import type { Flight } from "@prisma/client";
import type { ReactNode } from "react";
import { isLogbookEntry } from "@/lib/flights/recording";

function FlightArrow({
  flightId,
  direction,
}: {
  flightId: string | null;
  direction: "previous" | "next";
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = direction === "previous" ? "Previous log" : "Next log";
  const className =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border shadow-sm transition-colors";

  if (!flightId) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${label} unavailable`}
        title={`${label} unavailable`}
        className={`${className} cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <Link
      href={`/flights/${flightId}`}
      aria-label={label}
      title={label}
      className={`${className} border-gray-300 bg-paper text-gray-600 hover:border-gray-400 hover:text-ink`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}

export function FlightHeader({
  flight,
  isOwner,
  previousFlightId,
  nextFlightId,
  actions,
}: {
  flight: Flight;
  isOwner: boolean;
  previousFlightId: string | null;
  nextFlightId: string | null;
  actions: ReactNode;
}) {
  const hasLandingFix = flight.landingLat != null && flight.landingLon != null;
  // A named landing only earns its own display when it's somewhere other
  // than takeoff (e.g. not a top-landing back at launch) — otherwise it's
  // just noise repeating the title.
  const showLanding = hasLandingFix && flight.landingSiteId !== flight.takeoffSiteId;
  // SPRINT-008: a client component can't read process.env directly — the
  // gate's value is computed here (server-side) and threaded down as a
  // prop so NameSiteDialog's step machine can be gated too, not just the
  // data it renders.
  const zonesOn = zonesEnabled();
  const date = formatLocalDate(
    flight.takeoffAt ?? flight.flightDate,
    flight.takeoffAt ? flight.localUtcOffsetMinutes : 0,
  );
  const timeRange = `${formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} – ${formatLocalTime(flight.landingAt, flight.localUtcOffsetMinutes)}`;

  return (
    <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex min-w-0 items-center justify-start gap-1">
        <FlightArrow flightId={previousFlightId} direction="previous" />
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-condensed text-lg font-bold text-ink">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <CalendarDays className="h-4 w-4 text-[var(--replay-accent-strong)]" aria-hidden="true" />
            {date}
          </span>
          {flight.takeoffAt && <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Clock className="h-4 w-4 text-[var(--replay-accent-strong)]" aria-hidden="true" />
            {flight.landingAt ? timeRange : formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)}
          </span>}
        </div>
        <FlightArrow flightId={nextFlightId} direction="next" />
      </div>

      <div className="flex min-w-0 flex-col items-center gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-2">
          <SiteNameControl
            as="h1"
            flightId={flight.id}
            endpoint="takeoff"
            initialSiteName={flight.takeoffSiteName}
            initialZoneName={flight.takeoffZoneName}
            siteId={flight.takeoffSiteId}
            zoneId={flight.takeoffZoneId}
            isOwner={isOwner && !isLogbookEntry(flight)}
            zonesEnabled={zonesOn}
            className="font-condensed text-3xl font-bold tracking-tight text-ink"
          />
          {showLanding && (
            <>
              <span className="text-lg text-gray-400" aria-hidden="true">
                →
              </span>
              <SiteNameControl
                flightId={flight.id}
                endpoint="landing"
                initialSiteName={flight.landingSiteName}
                initialZoneName={flight.landingZoneName}
                siteId={flight.landingSiteId}
                zoneId={flight.landingZoneId}
                isOwner={isOwner && !isLogbookEntry(flight)}
                zonesEnabled={zonesOn}
                className="font-condensed text-base font-bold text-gray-500"
              />
            </>
          )}
        </div>
        <AccentBar width="3rem" className="h-[var(--replay-header-accent-height)] bg-[var(--replay-accent)]" />
      </div>

      <div className="flex items-center justify-start sm:justify-end">{actions}</div>
    </div>
  );
}
