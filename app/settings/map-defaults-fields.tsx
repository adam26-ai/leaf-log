"use client";
import { useState } from "react";
import { Mountain, Camera, Map as MapIcon, PencilLine, type LucideIcon } from "lucide-react";
import { BASEMAPS, hasMapTiler } from "@/components/flight/basemaps";
import { CAMERA_MODES, PLAYBACK_SPEEDS, readMapDefaults } from "@/lib/flights/map-defaults";
import { UnitsFields } from "./units-fields";

export function MapDefaultsFields({ units, customUnits, defaults, onChange }: { units: string; customUnits?: unknown; defaults: unknown; onChange?: () => void }) {
  const [value, setValue] = useState(() => readMapDefaults(defaults));
  const maps = BASEMAPS.filter(b => !b.needsKey || hasMapTiler());
  function control(Icon: LucideIcon, label: string, active: boolean, onClick: () => void) {
    return <div className="flex items-center gap-3">
      <button type="button" onClick={() => { onClick(); onChange?.(); }} title={`${label} — click to change`} aria-label={`${label} — click to change`} aria-pressed={active}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border shadow-sm transition-colors ${active ? "border-brand-blue bg-brand-blue/15 text-brand-blue-strong" : "border-gray-300 bg-gray-100 text-gray-600"}`}>
        <Icon className="h-4 w-4" />
      </button><span className="text-sm text-ink">{label}</span>
    </div>;
  }
  return <fieldset className="flex flex-col gap-3">
    <legend className="font-condensed text-sm font-bold tracking-wide text-ink">Map defaults</legend>
    <p className="text-xs text-gray-500">Starting settings for flight replay on every device. Click an icon to cycle its options.</p>
    <input type="hidden" name="map_defaults" value={JSON.stringify(value)} />
    <UnitsFields defaultUnits={units} customUnits={customUnits} />
    {control(Mountain, value.altitude === "agl" ? "Pilot altitude: AGL — above ground" : "Pilot altitude: MSL — mean sea level", value.altitude === "agl", () => setValue({...value, altitude: value.altitude === "agl" ? "asl" : "agl"}))}
    {control(Camera, `Camera: ${value.camera[0].toUpperCase()}${value.camera.slice(1)}`, value.camera !== "fixed", () => setValue({...value, camera: CAMERA_MODES[(CAMERA_MODES.indexOf(value.camera) + 1) % CAMERA_MODES.length]}))}
    {control(MapIcon, `Map: ${BASEMAPS.find(b => b.id === value.basemap)?.label}`, false, () => setValue({...value, basemap: maps[(maps.findIndex(b => b.id === value.basemap) + 1) % maps.length].id}))}
    {control(PencilLine, value.track === "elapsed" ? "Draw flight during playback" : "Always show full route", value.track === "elapsed", () => setValue({...value, track: value.track === "elapsed" ? "full" : "elapsed"}))}
    <label className="flex items-center gap-3"><select aria-label="Default playback speed" value={value.speed} onChange={e => { setValue({...value, speed: Number(e.target.value)}); onChange?.(); }} className="h-9 rounded-md border border-gray-300 bg-gray-100 px-2 text-sm text-ink shadow-sm">
      {PLAYBACK_SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
    </select><span className="text-sm text-ink">Playback speed</span></label>
  </fieldset>;
}
