import { AccentBar } from "@/components/ui/accent-bar";
import { SiteNameControl } from "@/components/flight/name-site-dialog";
import { zonesEnabled } from "@/lib/sites/zones-enabled";
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
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
        <AccentBar width="3rem" />
      </div>
    </div>
  );
}
