"use client";

import { useId, useState } from "react";
import dynamic from "next/dynamic";
import { XC_TYPE_LABELS } from "@/lib/flights/recording";
import { ENTRY_FIELDS, type EntryDraft, type EntryIssue } from "@/lib/logbook/entry";
import type { EntryOptions } from "@/lib/logbook/options";

const EntryMap = dynamic(() => import("./entry-map").then(module => module.EntryMap), { ssr: false, loading: () => <p className="p-4 text-sm text-gray-500">Loading map…</p> });
export const entryInputClass = "min-w-0 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";

export function EntryFields({ value, onChange, options, issues = [], expanded = false }: {
  value: EntryDraft; onChange: (next: EntryDraft) => void; options: EntryOptions; issues?: EntryIssue[]; expanded?: boolean;
}) {
  const uid = useId();
  const [showMap, setShowMap] = useState(false);
  const set = (patch: Partial<EntryDraft>) => onChange({ ...value, ...patch });
  const fieldError = (field: keyof EntryDraft) => issues.find(issue => issue.field === field)?.message;
  function input(field: keyof EntryDraft, label: string, type = "text", props: { placeholder?: string; list?: string; min?: number; max?: number } = {}) {
    const error = fieldError(field);
    return <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium text-gray-700">{label}</span>
      <input type={type} value={value[field]} {...props} maxLength={type === "text" ? 200 : undefined} step={type === "number" ? "any" : type === "time" ? 1 : undefined} aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? `${uid}-${field}-error` : undefined}
        onChange={event => set({ [field]: event.target.value, ...(["takeoffLat", "takeoffLon"].includes(field) ? { takeoffSiteId: "" } : ["landingLat", "landingLon"].includes(field) ? { landingSiteId: "" } : {}) })} className={entryInputClass} />
      {error && <span id={`${uid}-${field}-error`} className="text-xs text-red-600">{error}</span>}
    </label>;
  }
  function select(field: keyof EntryDraft, label: string, choices: Record<string, string>) {
    return <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-gray-700">{label}</span>
      <select value={value[field]} aria-label={label} onChange={event => set({ [field]: event.target.value })} className={entryInputClass} aria-invalid={Boolean(fieldError(field))}>
        {Object.entries(choices).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>{fieldError(field) && <span className="text-xs text-red-600">{fieldError(field)}</span>}
    </label>;
  }
  function site(endpoint: "takeoff" | "landing", label: string) {
    return <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-gray-700">{label}</span>
        <select aria-label={`Choose ${label.toLowerCase()}`} value={value[`${endpoint}SiteId`]} onChange={event => {
          const selected = options.sites.find(site => site.id === event.target.value);
          if (selected) set({ [`${endpoint}SiteId`]: selected.id, [`${endpoint}SiteName`]: selected.name, [`${endpoint}Lat`]: String(selected.lat), [`${endpoint}Lon`]: String(selected.lon) });
          else set({ [`${endpoint}SiteId`]: "" });
        }} className={entryInputClass}>
          <option value="">Enter a name below, or choose a site…</option>
          <optgroup label="From your logbook">{options.sites.filter(site => site.previous).map(site => <option key={site.id} value={site.id}>{site.name} ({site.lat.toFixed(2)}, {site.lon.toFixed(2)})</option>)}</optgroup>
          <optgroup label="Other available sites">{options.sites.filter(site => !site.previous).map(site => <option key={site.id} value={site.id}>{site.name} ({site.lat.toFixed(2)}, {site.lon.toFixed(2)})</option>)}</optgroup>
        </select>
      </label>
      <input aria-label={`${label} name`} value={value[`${endpoint}SiteName`]} list={`${uid}-sites`} placeholder="Site name (optional)"
        onChange={event => set({ [`${endpoint}SiteName`]: event.target.value, [`${endpoint}SiteId`]: "" })} className={entryInputClass} />
    </div>;
  }
  const total = Number(value.durationMinutes);
  const knownDuration = value.durationMinutes !== "" && Number.isFinite(total);
  return <div className="flex flex-col gap-5">
    <datalist id={`${uid}-wings`}>{options.wings.map(wing => <option key={wing} value={wing} />)}</datalist>
    <datalist id={`${uid}-sites`}>{options.siteNames.map(name => <option key={name} value={name} />)}</datalist>
    <div className="grid gap-4 sm:grid-cols-2">
      {input("date", "Flight date", "date")}
      <fieldset><legend className="mb-1.5 text-sm font-medium text-gray-700">Duration <span className="font-normal text-gray-400">(optional)</span></legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500"><input aria-label="Duration hours" type="number" min="0" max="168" value={knownDuration ? Math.floor(total / 60) : ""} placeholder="0"
            onChange={event => set({ durationMinutes: event.target.value === "" && !knownDuration ? "" : String(Number(event.target.value) * 60 + (knownDuration ? total % 60 : 0)) })} className={entryInputClass} />Hours</label>
          <label className="text-xs text-gray-500"><input aria-label="Duration minutes" type="number" min="0" max="59.99" step="any" value={knownDuration ? Number((total % 60).toFixed(4)) : ""} placeholder="0"
            onChange={event => set({ durationMinutes: event.target.value === "" && !knownDuration ? "" : String((knownDuration ? Math.floor(total / 60) * 60 : 0) + Number(event.target.value)) })} className={entryInputClass} />Minutes</label>
        </div>
        {value.durationMinutes && <button type="button" onClick={() => set({ durationMinutes: "" })} className="mt-1 text-xs text-gray-500 underline">Duration unknown</button>}
        {fieldError("durationMinutes") && <p className="mt-1 text-xs text-red-600">{fieldError("durationMinutes")}</p>}
      </fieldset>
      {input("glider", "Wing", "text", { list: `${uid}-wings`, placeholder: "Choose a previous wing or enter a name" })}
      {site("takeoff", "Flying site")}
    </div>
    <fieldset className="rounded-lg border border-gray-200 p-3"><legend className="px-1 text-sm font-medium text-gray-700">Reported XC <span className="font-normal text-gray-400">(optional)</span></legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="col-span-2 sm:col-span-1">{select("xcType", "XC type", { "": "Choose a route type…", ...XC_TYPE_LABELS })}</div>
        {input("xcDistance", "XC distance", "number", { min: 0 })}
        {select("distanceUnit", "Distance unit", { km: "km", mi: "Miles", nmi: "Nautical miles" })}
      </div>
      <p className="mt-2 text-xs text-gray-500">Counts toward personal bests in this category, marked as reported.</p>
    </fieldset>
    <details open={expanded || issues.some(issue => ["takeoffTime", "timeZone", "maxAltitude", "launchAltitude", "heightGained", "altitudeUnit", "varioUnit", "maxClimb", "maxSink", "occupancy"].includes(issue.field)) || undefined} className="rounded-lg border border-gray-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">More flight details</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {input("takeoffTime", "Takeoff time", "time")}
        {input("timeZone", "Time zone / UTC offset", "text", { placeholder: "America/Los_Angeles or -07:00" })}
        {select("altitudeUnit", "Altitude unit", { m: "Meters", ft: "Feet" })}
        {input("maxAltitude", "Maximum altitude (MSL)", "number")}
        {input("launchAltitude", "Launch altitude (MSL)", "number")}
        {input("heightGained", "Total climbs", "number", { min: 0 })}
        {select("varioUnit", "Vertical speed unit", { "m/s": "m/s", "ft/min": "ft/min", knots: "Knots" })}
        <div />
        {input("maxClimb", "Best climb", "number", { min: 0 })}
        {input("maxSink", "Max sink", "number")}
        {site("landing", "Landing site")}
        {select("occupancy", "Solo or tandem", { "": "Unknown", solo: "Solo", tandem: "Tandem" })}
      </div>
    </details>
    <details open={issues.some(issue => ["takeoffLat", "takeoffLon", "landingLat", "landingLon"].includes(issue.field)) || undefined} className="rounded-lg border border-gray-200 p-3"><summary className="cursor-pointer text-sm font-medium text-gray-700">Site location</summary>
      <p className="my-3 text-xs text-gray-500">A known site fills this in automatically. For an unlisted site, enter coordinates or choose a point on the map.</p>
      <div className="grid grid-cols-2 gap-3">{input("takeoffLat", "Site latitude", "number", { min: -90, max: 90 })}{input("takeoffLon", "Site longitude", "number", { min: -180, max: 180 })}</div>
      <button type="button" onClick={() => setShowMap(!showMap)} className="my-3 text-sm text-brand-blue-strong underline">{showMap ? "Hide map" : "Choose on map"}</button>
      {showMap && <EntryMap sites={options.sites}
        lat={value.takeoffLat ? Number(value.takeoffLat) : null} lon={value.takeoffLon ? Number(value.takeoffLon) : null}
        landingLat={value.landingLat ? Number(value.landingLat) : null} landingLon={value.landingLon ? Number(value.landingLon) : null}
        onPick={(lat, lon) => set({ takeoffSiteId: "", takeoffLat: String(lat), takeoffLon: String(lon) })}
        onPickLanding={(lat, lon) => set({ landingSiteId: "", landingLat: String(lat), landingLon: String(lon) })} />}
      <div className="mt-3 grid grid-cols-2 gap-3">{input("landingLat", "Landing latitude", "number", { min: -90, max: 90 })}{input("landingLon", "Landing longitude", "number", { min: -180, max: 180 })}</div>
    </details>
    <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">{ENTRY_FIELDS.notes}
      <textarea value={value.notes} onChange={event => set({ notes: event.target.value })} rows={3} maxLength={2000} placeholder="What would you like to remember?" className={entryInputClass} />
      {fieldError("notes") && <span className="text-xs text-red-600">{fieldError("notes")}</span>}
    </label>
  </div>;
}
