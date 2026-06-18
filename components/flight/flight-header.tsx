import { AccentBar } from "@/components/ui/accent-bar";
import { formatLocalDate, formatLocalTime } from "@/lib/flights/format";
import type { Tables } from "@/lib/database.types";

export function FlightHeader({ flight }: { flight: Tables<"flights"> }) {
  const offset = flight.local_utc_offset_minutes;
  const site = flight.takeoff_site_name ?? "Unknown site";
  const takeoff = formatLocalTime(flight.takeoff_at, offset);
  const landing = formatLocalTime(flight.landing_at, offset);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-condensed text-4xl font-bold tracking-tight text-ink">
          {site}
        </h1>
        <AccentBar width="3rem" />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
        <span>{formatLocalDate(flight.takeoff_at ?? flight.flight_date, offset)}</span>
        <span className="font-mono">
          {takeoff} – {landing}
          {flight.local_tz ? ` (${flight.local_tz})` : ""}
        </span>
        {flight.glider && <span>{flight.glider}</span>}
      </div>
    </div>
  );
}
