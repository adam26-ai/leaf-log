import { cn } from "@/lib/utils";
import type { InstrumentReading } from "@/lib/flights/instruments";
import { formatAltitude, formatVario, formatSpeed, type UnitSystem } from "@/lib/flights/format";

/** "1,234 ft" -> ["1,234", "ft"] — splits a formatted value on its last
 *  space so the unit can render smaller, next to the number. */
function splitUnit(s: string): [string, string] {
  const i = s.lastIndexOf(" ");
  return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
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
 * sleek dark glass overlay (altitude / vario / speed). Renders nothing until
 * there's a selected point. Units follow the same Metric/Imperial preference
 * as the key-statistics card (lib/flights/use-units.ts).
 */
export function InstrumentReadout({
  reading,
  units = "metric",
}: {
  reading: InstrumentReading | null;
  units?: UnitSystem;
}) {
  if (!reading) return null;
  const v = reading.varioMs;
  const [altValue, altUnit] = splitUnit(formatAltitude(reading.altM, units));
  const [varioValue, varioUnit] = splitUnit(formatVario(v, units));
  const [speedValue, speedUnit] = splitUnit(formatSpeed(reading.speedKmh, units));
  return (
    <div className="inline-flex items-center gap-6 rounded-2xl bg-ink/85 px-5 py-2.5 shadow-lg backdrop-blur-sm sm:gap-8">
      <Cell label="Altitude" value={altValue} unit={altUnit} />
      <Cell
        label="Vario"
        value={varioValue}
        unit={varioUnit}
        tone={v > 0.1 ? "climb" : v < -0.1 ? "sink" : undefined}
      />
      <Cell label="Speed" value={speedValue} unit={speedUnit} />
    </div>
  );
}
