import { cn } from "@/lib/utils";
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
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "climb" | "sink";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          className={cn(
            "font-condensed text-2xl font-bold leading-none tabular-nums",
            tone === "climb" ? "text-leaf-strong" : tone === "sink" ? "text-red-400" : "text-white",
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-gray-400">{unit}</span>}
      </span>
    </div>
  );
}

/**
 * Live instrument panel for the point under the cursor / 3D replay position — a
 * sleek dark glass overlay (time / altitude / vario / speed). Renders nothing
 * until there's a selected point.
 */
export function InstrumentReadout({ reading }: { reading: InstrumentReading | null }) {
  if (!reading) return null;
  const v = reading.varioMs;
  return (
    <div className="inline-flex items-center gap-6 rounded-2xl bg-ink/85 px-5 py-2.5 shadow-lg backdrop-blur-sm sm:gap-8">
      <Cell label="Time" value={clock(reading.timeMs, reading.offsetMin)} />
      <Cell label="Altitude" value={reading.altM.toLocaleString()} unit="m" />
      <Cell
        label="Vario"
        value={`${v > 0 ? "+" : ""}${v.toFixed(1)}`}
        unit="m/s"
        tone={v > 0.1 ? "climb" : v < -0.1 ? "sink" : undefined}
      />
      <Cell label="Speed" value={String(reading.speedKmh)} unit="km/h" />
    </div>
  );
}
