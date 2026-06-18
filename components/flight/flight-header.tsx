import { AccentBar } from "@/components/ui/accent-bar";
import { formatLocalDate, formatLocalTime } from "@/lib/flights/format";
import type { Flight } from "@prisma/client";

export function FlightHeader({ flight }: { flight: Flight }) {
  const offset = flight.localUtcOffsetMinutes;
  const site = flight.takeoffSiteName ?? "Unknown site";
  const takeoff = formatLocalTime(flight.takeoffAt, offset);
  const landing = formatLocalTime(flight.landingAt, offset);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-condensed text-4xl font-bold tracking-tight text-ink">
          {site}
        </h1>
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
    </div>
  );
}
