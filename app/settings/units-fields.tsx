"use client";

import { useState } from "react";
import { UnitsIcon } from "@/components/units-icon";
import { readCustomUnits, readUnitMode, resolveUnits, UNIT_OPTIONS, type UnitMode, type UnitPreferences } from "@/lib/flights/units";

export function UnitsFields({ defaultUnits, customUnits }: { defaultUnits: string; customUnits?: unknown }) {
  const [custom, setCustom] = useState(() => readCustomUnits(customUnits));
  const [mode, setMode] = useState(() => readUnitMode(defaultUnits, custom));
  return <div className="flex flex-col gap-3">
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-gray-300 bg-gray-100 text-gray-600 shadow-sm">
        <UnitsIcon mode={mode} />
      </span>
      <select name="default_units" aria-label="Units" value={mode} onChange={event => {
        const next = event.target.value as UnitMode;
        if (next === "custom" && !custom) setCustom(resolveUnits(mode === "imperial" ? "imperial" : "metric"));
        setMode(next);
      }} className="h-9 rounded-md border border-gray-300 bg-gray-100 px-2 text-sm text-ink shadow-sm focus-visible:outline-brand-blue">
        <option value="metric">Metric (m)</option>
        <option value="imperial">Imperial (ft)</option>
        <option value="custom">Custom</option>
      </select>
    </div>
    <input type="hidden" name="custom_units" value={JSON.stringify(custom)} />
    {mode === "custom" && custom && <div className="ml-12 flex flex-col gap-3 border-l border-gray-200 pl-3">
      {(Object.keys(UNIT_OPTIONS) as (keyof UnitPreferences)[]).map(key => <fieldset key={key}>
        <legend className="mb-1.5 text-xs font-medium text-gray-600">{UNIT_OPTIONS[key].label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(UNIT_OPTIONS[key].choices).map(([value, label]) => <label key={value} className="cursor-pointer rounded-md border border-gray-200 bg-paper px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-brand-blue has-[:checked]:border-brand-blue has-[:checked]:bg-brand-blue/10 has-[:checked]:text-brand-blue-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-blue">
            <input type="radio" name={`unit_${key}`} value={value} checked={custom[key] === value}
              onChange={() => setCustom({ ...custom, [key]: value })} className="sr-only" />
            {label}
          </label>)}
        </div>
      </fieldset>)}
    </div>}
  </div>;
}
