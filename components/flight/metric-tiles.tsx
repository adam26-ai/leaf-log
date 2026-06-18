import { AccentBar } from "@/components/ui/accent-bar";
import { Card } from "@/components/ui/card";
import {
  formatDuration,
  formatAltitude,
  formatDistance,
  formatVario,
} from "@/lib/flights/format";
import type { Tables } from "@/lib/database.types";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className="font-condensed text-3xl font-bold tabular-nums text-ink">
        {value}
      </span>
      <AccentBar width="1.75rem" />
    </Card>
  );
}

/** The beginner-friendly metric grid (plain labels, not competition jargon). */
export function MetricTiles({ flight }: { flight: Tables<"flights"> }) {
  const tiles: [string, string][] = [
    ["Airtime", formatDuration(flight.duration_s)],
    ["Max altitude", formatAltitude(flight.max_alt_m)],
    ["Height gained", formatAltitude(flight.alt_gain_m)],
    ["Best climb", formatVario(flight.max_climb_ms)],
    ["Strongest sink", formatVario(flight.max_sink_ms)],
    ["Track distance", formatDistance(flight.track_dist_m)],
    ["Straight line", formatDistance(flight.straight_dist_m)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map(([label, value]) => (
        <Tile key={label} label={label} value={value} />
      ))}
    </div>
  );
}
