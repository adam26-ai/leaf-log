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
    <div className="flex shrink-0 flex-col gap-1 px-3 py-2">
      <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className="whitespace-nowrap font-condensed text-xl font-bold tabular-nums text-ink">
        {value}
      </span>
      <AccentBar width="1.25rem" />
    </div>
  );
}

/**
 * Compact summary strip — all the flight's headline numbers on one row (scrolls
 * horizontally on narrow screens), keeping the map/3D more above-the-fold.
 */
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
    <Card className="overflow-hidden">
      <div className="flex gap-1 divide-x divide-gray-100 overflow-x-auto">
        {tiles.map(([label, value]) => (
          <Tile key={label} label={label} value={value} />
        ))}
      </div>
    </Card>
  );
}
