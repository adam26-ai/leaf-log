"use client";

import { Flag, LifeBuoy, Cable, Users } from "lucide-react";
import { FLIGHT_FLAGS, FLIGHT_FLAG_LABELS, type FlightFlag } from "@/lib/flights/type-flags";

const icons = { tandem: Users, siv: LifeBuoy, competition: Flag, tow: Cable };

export function FlightTypeFields({ value, onChange, disabled = false }: { value: FlightFlag[]; onChange: (value: FlightFlag[]) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="mb-2 text-sm font-medium text-gray-700">Flight type <span className="font-normal text-gray-500">(select all that apply)</span></legend>
    <div className="flex flex-wrap gap-2">{FLIGHT_FLAGS.map(flag => {
      const Icon = icons[flag];
      return <label key={flag} className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm has-[:checked]:border-brand-blue has-[:checked]:bg-blue-50">
        <input type="checkbox" checked={value.includes(flag)} onChange={event => onChange(event.target.checked ? [...value, flag] : value.filter(item => item !== flag))} className="accent-brand-blue" />
        <Icon aria-hidden="true" className="h-4 w-4" />{FLIGHT_FLAG_LABELS[flag]}
      </label>;
    })}</div>
  </fieldset>;
}

export function FlightTypeBadges({ flags }: { flags: FlightFlag[] }) {
  return <>{flags.map(flag => {
    const Icon = icons[flag];
    return <span key={flag} title={FLIGHT_FLAG_LABELS[flag]} aria-label={FLIGHT_FLAG_LABELS[flag]} className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-brand-blue/25 bg-blue-50 text-brand-blue-strong"><Icon aria-hidden="true" className="h-4 w-4" /></span>;
  })}</>;
}
