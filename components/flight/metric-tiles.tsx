import { AccentBar } from "@/components/ui/accent-bar";
import { Card } from "@/components/ui/card";
import {
  formatDuration,
  formatAltitude,
  formatDistance,
  formatVario,
} from "@/lib/flights/format";
import type { Flight } from "@prisma/client";

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
export function MetricTiles({ flight }: { flight: Flight }) {
  const tiles: [string, string][] = [
    ["Airtime", formatDuration(flight.durationS)],
    ["Max altitude", formatAltitude(flight.maxAltM)],
    ["Height gained", formatAltitude(flight.altGainM)],
    ["Best climb", formatVario(flight.maxClimbMs)],
    ["Strongest sink", formatVario(flight.maxSinkMs)],
    ["Track distance", formatDistance(flight.trackDistM)],
    ["Straight line", formatDistance(flight.straightDistM)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map(([label, value]) => (
        <Tile key={label} label={label} value={value} />
      ))}
    </div>
  );
}
