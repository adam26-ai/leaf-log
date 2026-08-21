import { AccentBar } from "@/components/ui/accent-bar";
import { formatLocalDate, formatLocalTime } from "@/lib/flights/format";
import { SiteNameControl } from "@/components/flight/name-site-dialog";
import { formatLocationLabel } from "@/lib/sites/display";
import type { Flight } from "@prisma/client";

export function FlightHeader({ flight, isOwner }: { flight: Flight; isOwner: boolean }) {
  const offset = flight.localUtcOffsetMinutes;
  const takeoff = formatLocalTime(flight.takeoffAt, offset);
  const landing = formatLocalTime(flight.landingAt, offset);
  const hasLandingFix = flight.landingLat != null && flight.landingLon != null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SiteNameControl
          as="h1"
          flightId={flight.id}
          endpoint="takeoff"
          initialName={formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName)}
          isOwner={isOwner}
          className="font-condensed text-4xl font-bold tracking-tight text-ink"
        />
        <AccentBar width="3rem" />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
        <span>{formatLocalDate(flight.takeoffAt ?? flight.flightDate, offset)}</span>
        <span className="font-mono">
          {takeoff} – {landing}
          {flight.localTz ? ` (${flight.localTz})` : ""}
        </span>
        {flight.glider && <span>{flight.glider}</span>}
      </div>
      {hasLandingFix && (
        <div className="flex items-center gap-1.5 text-sm text-gray-600">
          <span className="text-gray-400">Landing:</span>
          <SiteNameControl
            flightId={flight.id}
            endpoint="landing"
            initialName={formatLocationLabel(flight.landingSiteName, flight.landingZoneName)}
            isOwner={isOwner}
            className="font-medium text-gray-700"
          />
        </div>
      )}
    </div>
  );
}
