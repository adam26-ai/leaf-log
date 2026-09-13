"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EntryMapSearch } from "@/components/logbook/entry-map-search";
import { BoundaryEditor, type BoundaryEditorHandle } from "./boundary-editor";
import { hasSitePoint, siteDraftSchema, type SiteEditorValue, type SiteDraft, type SitePoint } from "@/lib/sites/model";
import { validateSiteName } from "@/lib/sites/name";
import { validateBoundary } from "@/lib/sites/boundary";
import { radiusForKind } from "@/lib/sites/geo";

/** The same draft editor is embedded in flights, import review, and management. */
export function SiteEditor({ initial, pinSource, flightPoint = null, canChangeVisibility = true, usageCount, saveLabel = "Save site", onSave, onCancel }: {
  initial: SiteEditorValue; pinSource?: string; flightPoint?: SitePoint | null; canChangeVisibility?: boolean; usageCount?: number;
  saveLabel?: string; onSave: (draft: SiteDraft) => Promise<void>; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [lat, setLat] = useState(initial.lat === null ? "" : String(initial.lat));
  const [lon, setLon] = useState(initial.lon === null ? "" : String(initial.lon));
  const [mode, setMode] = useState<"anchor" | "boundary">("anchor");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const map = useRef<BoundaryEditorHandle>(null);
  const point = { lat: lat.trim() ? Number(lat) : null, lon: lon.trim() ? Number(lon) : null };
  const mapped = hasSitePoint(point);
  const anchor = mapped ? point : flightPoint ?? { lat: 25, lon: 0 };
  const inputClass = "mt-1.5 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";
  function placePin(next: SitePoint) { setLat(String(Number(next.lat.toFixed(6)))); setLon(String(Number(next.lon.toFixed(6)))); }
  async function save() {
    setError(null);
    const raw = { ...value, ...point, boundary: map.current ? map.current.readDraft() : value.boundary };
    const shape = siteDraftSchema.safeParse(raw);
    if (!shape.success) { setError("Check the name and coordinates before saving."); return; }
    const name = validateSiteName(value.name);
    if (!name.ok) { setError("Enter a site name with 2–60 characters, using letters, numbers, spaces, or ordinary punctuation."); return; }
    if ((point.lat === null) !== (point.lon === null)) { setError("Enter both latitude and longitude, or leave both blank."); return; }
    if (value.visibility === "public" && !mapped) { setError("Add a map pin before sharing this site."); return; }
    if (raw.boundary !== null) {
      if (!mapped) { setError("Place the site pin inside the boundary before saving."); return; }
      const boundary = validateBoundary(raw.boundary, "site", point);
      if (!boundary.ok) { setError(`Check the boundary: ${boundary.error.replaceAll("_", " ")}.`); return; }
      raw.boundary = boundary.boundary;
    }
    setPending(true);
    try { await onSave({ ...raw, name: name.name }); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save the site. Your draft is still here."); }
    finally { setPending(false); }
  }
  return <section aria-label="Site editor" className="flex flex-col gap-4">
    <div><h2 className="font-condensed text-xl font-bold text-ink">{initial.id ? "Edit site" : "Site details"}</h2>
      <p className="mt-1 text-sm text-gray-600">{mapped ? "Mapped site" : flightPoint ? "Location needs review" : "Name only"} · {value.visibility === "public" ? "Public" : "Private"}</p>
      {value.visibility === "public" ? <p className="mt-1 text-sm text-gray-600">Changes to this public site are shared with other pilots.</p>
        : Boolean(usageCount && usageCount > 1) && <p className="mt-1 text-sm text-gray-600">Used by {usageCount} of your flights. Site changes appear on all of them.</p>}
    </div>
    {mapped && <p className="text-xs text-gray-600">{point.lat !== initial.lat || point.lon !== initial.lon ? 'Pin set by you' : ({ manual: 'Pin set by you', csv: 'Pin from CSV', flight_gps: 'Pin from flight GPS', legacy: 'Pin origin unknown' } as Record<string, string>)[pinSource ?? 'legacy'] ?? 'Pin origin unknown'}.</p>}
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
      <label className="text-sm font-medium text-gray-700">Name<input value={value.name} maxLength={60} onChange={e => setValue({ ...value, name: e.target.value })} className={inputClass} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">Used for<select aria-label="Used for" value={value.kind} onChange={e => setValue({ ...value, kind: e.target.value as SiteDraft["kind"] })} className={inputClass}>
          <option value="takeoff">Takeoff</option><option value="landing">Landing</option><option value="both">Takeoff and landing</option></select></label>
        <label className="text-sm font-medium text-gray-700">Visibility<select aria-label="Visibility" value={value.visibility} disabled={!canChangeVisibility} onChange={e => setValue({ ...value, visibility: e.target.value as SiteDraft["visibility"] })} className={inputClass}>
          <option value="private">Private</option><option value="public" disabled={!mapped}>Public</option></select></label>
      </div>
      <p className="text-xs text-gray-600">{!canChangeVisibility ? "Only the site owner can change visibility." : !mapped ? "Add a map pin before sharing this site." : "Private sites are visible only to you. Sharing a site does not share your flights."}</p>
      <EntryMapSearch sites={[]} onLocate={place => map.current?.locate(place)} />
      <div role="group" aria-label="Site editing tool" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" aria-pressed={mode === "anchor"} onClick={() => setMode("anchor")}>Place or move pin</Button>
        <Button type="button" variant="outline" aria-pressed={mode === "boundary"} onClick={() => setMode("boundary")}>Draw or edit boundary</Button>
        {flightPoint && <Button type="button" variant="outline" onClick={() => { placePin(flightPoint); map.current?.locate(flightPoint); }}>Use this flight’s position</Button>}
      </div>
      <BoundaryEditor ref={map} anchor={anchor} anchorVisible={mapped} initialBoundary={initial.boundary} editingMode={mode} onAnchorChange={placePin}
        flightPoint={flightPoint} level="site" referenceRadiusM={mapped ? radiusForKind(value.kind === "landing" ? "landing" : "takeoff") : undefined}
        showSaveButton={false} showCancel={false} onSave={async () => ({ ok: true })} onClear={async () => ({ ok: true })} onCancel={onCancel} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-gray-700">Pin latitude<input aria-label="Pin latitude" type="number" step="any" min={-90} max={90} value={lat} onChange={e => setLat(e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium text-gray-700">Pin longitude<input aria-label="Pin longitude" type="number" step="any" min={-180} max={180} value={lon} onChange={e => setLon(e.target.value)} className={inputClass} /></label>
      </div>
      <p className="text-xs text-gray-600">The pin and boundary describe this site. They do not change any flight’s recorded coordinates. The boundary, or default matching circle, suggests sites for future flights.</p>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      <Button type="button" disabled={pending} onClick={() => void save()}>{pending ? "Saving…" : saveLabel}</Button></div>
  </section>;
}
