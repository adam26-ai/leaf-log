import type { InstrumentReading } from "@/lib/flights/instruments";
import { formatAltitude, formatVario, formatSpeed, type UnitSystem } from "@/lib/flights/format";
import { rangedReplayColor, replayColorCss, varioReplayColor } from "./replay-palette";

export interface InstrumentRanges {
  altMinM: number;
  altMaxM: number;
  speedMinKmh: number;
  speedMaxKmh: number;
}

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
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span className="flex items-baseline justify-center gap-1 whitespace-nowrap">
        <span
          className="font-condensed text-2xl font-bold leading-none tabular-nums"
          style={{ color }}
        >
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium opacity-80" style={{ color }}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Live instrument panel for the point under the cursor / 3D replay position — a
 * sleek dark glass overlay (altitude / vario / speed). Renders nothing until
 * there's a selected point. Units follow the same Metric/US units preference
 * as the key-statistics card (lib/flights/use-units.ts).
 */
export function InstrumentReadout({
  reading,
  units = "metric",
  ranges,
}: {
  reading: InstrumentReading | null;
  units?: UnitSystem;
  ranges?: InstrumentRanges | null;
}) {
  if (!reading) return null;
  const v = reading.varioMs;
  const [altValue, altUnit] = splitUnit(formatAltitude(reading.altM, units));
  const [varioValue, varioUnit] = splitUnit(formatVario(v, units));
  const [speedValue, speedUnit] = splitUnit(formatSpeed(reading.speedKmh, units));
  const altColor = replayColorCss(
    rangedReplayColor(reading.altM, ranges?.altMinM ?? 0, ranges?.altMaxM ?? 0),
  );
  const varioColor = replayColorCss(varioReplayColor(v));
  const speedColor = replayColorCss(
    rangedReplayColor(
      reading.speedKmh,
      ranges?.speedMinKmh ?? 0,
      ranges?.speedMaxKmh ?? 0,
    ),
  );
  return (
    <div className="grid w-80 max-w-full grid-cols-3 items-center rounded-2xl bg-ink/85 px-4 py-2.5 shadow-lg backdrop-blur-sm">
      <Cell label="Altitude MSL" value={altValue} unit={altUnit} color={altColor} />
      <Cell label="Vario" value={varioValue} unit={varioUnit} color={varioColor} />
      <Cell label="Speed" value={speedValue} unit={speedUnit} color={speedColor} />
    </div>
  );
}
