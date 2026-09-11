"use client";
import { UnitsIcon } from "@/components/units-icon";
import { UNIT_MODE_LABELS, type UnitMode } from "@/lib/flights/units";
import { useUnits } from "@/lib/flights/use-units";

export function UnitToggle() {
  const { mode, setMode, hasCustom } = useUnits();
  const modes: UnitMode[] = hasCustom ? ["metric", "imperial", "custom"] : ["metric", "imperial"];
  const next = modes[(modes.indexOf(mode) + 1) % modes.length];
  const label = `${UNIT_MODE_LABELS[mode]} units (click for ${UNIT_MODE_LABELS[next]})`;
  return <button type="button" aria-label={label} title={label} onClick={() => setMode(next)}
    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-ink">
    <UnitsIcon mode={mode} />
  </button>;
}
