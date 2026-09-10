export type UnitMode = "metric" | "imperial" | "custom";

export type UnitPreferences = {
  altitude: "m" | "ft";
  speed: "kph" | "mph" | "knots";
  distance: "km" | "miles" | "nautical-miles";
  vario: "m/s" | "ft/min" | "knots";
};

/** Presets remain accepted by formatters and standalone replay components. */
export type UnitSystem = "metric" | "imperial" | UnitPreferences;

export const METRIC_UNITS: UnitPreferences = { altitude: "m", speed: "kph", distance: "km", vario: "m/s" };
export const IMPERIAL_UNITS: UnitPreferences = { altitude: "ft", speed: "mph", distance: "miles", vario: "ft/min" };

export const UNIT_OPTIONS = {
  altitude: { label: "Altitude", choices: { m: "Meters", ft: "Feet" } },
  speed: { label: "Speed", choices: { kph: "kph", mph: "mph", knots: "Knots" } },
  distance: { label: "Distance", choices: { km: "km", miles: "Miles", "nautical-miles": "Nautical miles" } },
  vario: { label: "Vertical speed", choices: { "m/s": "m/s", "ft/min": "ft/min", knots: "Knots" } },
} as const;

export const UNIT_MODE_LABELS: Record<UnitMode, string> = { metric: "Metric", imperial: "Imperial", custom: "Custom" };

export function resolveUnits(units: UnitSystem): UnitPreferences {
  return units === "metric" ? METRIC_UNITS : units === "imperial" ? IMPERIAL_UNITS : units;
}

/** Accept only a complete, valid saved configuration and discard extra fields. */
export function readCustomUnits(value: unknown): UnitPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(UNIT_OPTIONS) as (keyof UnitPreferences)[]) {
    if (typeof record[key] !== "string" || !Object.hasOwn(UNIT_OPTIONS[key].choices, record[key])) return null;
  }
  return { altitude: record.altitude, speed: record.speed, distance: record.distance, vario: record.vario } as UnitPreferences;
}

export function readUnitMode(value: unknown, customUnits: UnitPreferences | null): UnitMode {
  return value === "imperial" ? "imperial" : value === "custom" && customUnits ? "custom" : "metric";
}
