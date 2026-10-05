"use client";
import { hasMapTiler, type BasemapId } from "./basemaps";

export function SiteMapControls({ value, onChange }: { value: BasemapId; onChange: (value: BasemapId) => void }) {
  return <div role="group" aria-label="Site map style" className="flex w-fit gap-1 rounded-md border border-gray-300 bg-paper p-1 shadow-sm">
    {(["monochrome", "satellite"] as const).map(style => <button key={style} type="button" disabled={style === "satellite" && !hasMapTiler()}
      aria-pressed={value === style} title={style === "satellite" && !hasMapTiler() ? "Satellite imagery is unavailable" : undefined}
      onClick={() => onChange(style)} className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-40 ${value === style ? "bg-blue-50 text-brand-blue-strong" : "text-gray-600 hover:bg-gray-100"}`}>
      {style === "monochrome" ? "Map" : "Satellite"}
    </button>)}
  </div>;
}

export function SiteMapLegend({ flightPoint = false, siteName, otherSites = false }: { flightPoint?: boolean; siteName?: string; otherSites?: boolean }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-blue" />{siteName ? `${siteName} ` : ""}Site pin &amp; boundary</span>
    {otherSites && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-600" />Other sites</span>}
    {flightPoint && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-ink-soft bg-success-accent" />Flight position</span>}
  </div>;
}
