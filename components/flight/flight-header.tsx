import { AccentBar } from "@/components/ui/accent-bar";
import { SiteNameControl } from "@/components/flight/name-site-dialog";
import { zonesEnabled } from "@/lib/sites/zones-enabled";
import { CalendarDays, Clock } from "lucide-react";
import { formatLocalDate, formatLocalTime } from "@/lib/flights/format";
import type { Flight } from "@prisma/client";

export function FlightHeader({ flight, isOwner }: { flight: Flight; isOwner: boolean }) {
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
    flight.localUtcOffsetMinutes,
  );
  const timeRange = `${formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} – ${formatLocalTime(flight.landingAt, flight.localUtcOffsetMinutes)}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <SiteNameControl
            as="h1"
            flightId={flight.id}
            endpoint="takeoff"
            initialSiteName={flight.takeoffSiteName}
            initialZoneName={flight.takeoffZoneName}
            siteId={flight.takeoffSiteId}
            zoneId={flight.takeoffZoneId}
            isOwner={isOwner}
            zonesEnabled={zonesOn}
            className="font-condensed text-4xl font-bold tracking-tight text-ink"
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
                isOwner={isOwner}
                zonesEnabled={zonesOn}
                className="font-condensed text-lg font-bold text-gray-500"
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <CalendarDays className="h-3.5 w-3.5 text-amber-strong" aria-hidden="true" />
            {date}
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Clock className="h-3.5 w-3.5 text-amber-strong" aria-hidden="true" />
            {timeRange}
          </span>
        </div>
      </div>
      <AccentBar width="3rem" />
    </div>
  );
}
