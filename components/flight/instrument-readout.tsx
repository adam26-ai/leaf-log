import { cn } from "@/lib/utils";
import { formatVario } from "@/lib/flights/format";
import type { InstrumentReading } from "@/lib/flights/instruments";

function clock(timeMs: number, offsetMin: number) {
  const d = new Date(timeMs + offsetMin * 60_000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}`;
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "climb" | "sink";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <span
        className={cn(
          "font-condensed font-bold tabular-nums",
          tone === "climb" ? "text-leaf-strong" : tone === "sink" ? "text-red-600" : "text-ink",
        )}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Live instrument panel for the point under the cursor (hover) or the 3D replay
 * position — a mini vario/altimeter for the selected moment.
 */
export function InstrumentReadout({ reading }: { reading: InstrumentReading | null }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-gray-200 bg-paper px-3 py-1.5 text-sm">
      {reading ? (
        <>
          <Cell label="Time" value={clock(reading.timeMs, reading.offsetMin)} />
          <Cell label="Altitude" value={`${reading.altM.toLocaleString()} m`} />
          <Cell
            label="Vario"
            value={formatVario(reading.varioMs)}
            tone={reading.varioMs > 0.1 ? "climb" : reading.varioMs < -0.1 ? "sink" : undefined}
          />
          <Cell label="Speed" value={`${reading.speedKmh} km/h`} />
        </>
      ) : (
        <span className="text-gray-400">
          Hover the profile or map — or play the 3D replay — to read the instruments at any
          point.
        </span>
      )}
    </div>
  );
}
