"use client";

import { useRef, useState } from "react";
import { Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntryMapSearch } from "@/components/logbook/entry-map-search";
import { BoundaryEditor, type BoundaryEditorHandle } from "./boundary-editor";
import { hasSitePoint, siteDraftSchema, type SiteEditorValue, type SiteDraft, type SitePoint } from "@/lib/sites/model";
import { validateSiteName } from "@/lib/sites/name";
import { validateBoundary } from "@/lib/sites/boundary";
import { radiusForKind } from "@/lib/sites/geo";

/** The same draft editor is embedded in flights, import review, and management. */
export function SiteEditor({ initial, flightPoint = null, canChangeVisibility = true, usageCount, saveLabel = "Save site", onSave, onCancel }: {
  initial: SiteEditorValue; pinSource?: string; flightPoint?: SitePoint | null; canChangeVisibility?: boolean; usageCount?: number;
  saveLabel?: string; onSave: (draft: SiteDraft) => Promise<void>; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [lat, setLat] = useState(initial.lat === null ? "" : String(initial.lat));
  const [lon, setLon] = useState(initial.lon === null ? "" : String(initial.lon));
  const [mode, setMode] = useState<"anchor" | "boundary">("anchor");
  const [pending, setPending] = useState(false);
  const [visibilityHelp, setVisibilityHelp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const map = useRef<BoundaryEditorHandle>(null);
  const point = { lat: lat.trim() ? Number(lat) : null, lon: lon.trim() ? Number(lon) : null };
  const mapped = hasSitePoint(point);
  const anchor = mapped ? point : flightPoint ?? { lat: 25, lon: 0 };
  const inputClass = "mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";
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
  return <section aria-label="Site editor" className="flex flex-col gap-2">
    <h2 className="font-condensed text-xl font-bold text-ink">{initial.id ? "Edit site" : "Site details"}</h2>
    {Boolean(usageCount && usageCount > 1) && <p className="text-xs text-gray-500">Used by {usageCount} of your flights.</p>}
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-end gap-3">
        <label className="min-w-0 flex-1 text-xs font-medium text-gray-700">Name<input value={value.name} maxLength={60} onChange={e => setValue({ ...value, name: e.target.value })} className={inputClass} /></label>
        <div className="shrink-0"><span className="block text-xs font-medium text-gray-700">Visibility</span><div className="mt-1 flex items-center gap-1" role="group" aria-label="Visibility">
          {(["private", "public"] as const).map(visibility => {
            const Icon = visibility === "public" ? Globe : Lock;
            return <button key={visibility} type="button" aria-label={visibility === "public" ? "Public" : "Private"} aria-pressed={value.visibility === visibility}
              onClick={() => {
                if (!canChangeVisibility) { setVisibilityHelp("Only the site owner can change visibility."); return; }
                if (visibility === "public" && !mapped) { setVisibilityHelp("Add a map pin before sharing this site."); return; }
                setVisibilityHelp(null); setValue({ ...value, visibility });
              }} className={`rounded-md border p-2 ${value.visibility === visibility ? "border-brand-blue bg-brand-blue/15 text-brand-blue-strong" : "border-gray-300 text-gray-500 hover:bg-gray-100"}`}><Icon className="h-4 w-4" /></button>;
          })}
          <span className="ml-1 w-10 text-xs text-gray-600">{value.visibility === "public" ? "Public" : "Private"}</span>
        </div></div>
      </div>
      {visibilityHelp && <p role="status" className="text-xs text-orange-700">{visibilityHelp}</p>}
      <label className="flex items-center gap-2 text-xs font-medium text-gray-700">Used for<select aria-label="Used for" value={value.kind} onChange={e => setValue({ ...value, kind: e.target.value as SiteDraft["kind"] })} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
        <option value="takeoff">Takeoff</option><option value="landing">Landing</option><option value="both">Takeoff and landing</option></select></label>
      <EntryMapSearch compact sites={[]} onLocate={place => map.current?.locate(place)} />
      <div role="group" aria-label="Site editing tool" className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={mode === "anchor" ? "primary" : "outline"} aria-pressed={mode === "anchor"} onClick={() => setMode("anchor")}>Place or move pin</Button>
        <Button type="button" size="sm" variant={mode === "boundary" ? "primary" : "outline"} aria-pressed={mode === "boundary"} onClick={() => setMode("boundary")}>Draw or edit boundary</Button>
        {flightPoint && <Button type="button" variant="outline" onClick={() => { placePin(flightPoint); map.current?.locate(flightPoint); }}>Use this flight’s position</Button>}
      </div>
      <BoundaryEditor compact ref={map} anchor={anchor} anchorVisible={mapped} initialBoundary={initial.boundary} editingMode={mode} onAnchorChange={placePin}
        flightPoint={flightPoint} level="site" referenceRadiusM={mapped ? radiusForKind(value.kind === "landing" ? "landing" : "takeoff") : undefined}
        showSaveButton={false} showCancel={false} onSave={async () => ({ ok: true })} onClear={async () => ({ ok: true })} onCancel={onCancel} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-gray-700">Pin latitude<input aria-label="Pin latitude" type="number" step="any" min={-90} max={90} value={lat} onChange={e => setLat(e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium text-gray-700">Pin longitude<input aria-label="Pin longitude" type="number" step="any" min={-180} max={180} value={lon} onChange={e => setLon(e.target.value)} className={inputClass} /></label>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="sticky bottom-0 flex justify-end gap-2 bg-paper py-2"><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      <Button type="button" disabled={pending} onClick={() => void save()}>{pending ? "Saving…" : saveLabel}</Button></div>
  </section>;
}
