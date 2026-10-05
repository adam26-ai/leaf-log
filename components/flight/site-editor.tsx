"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntryMapSearch } from "@/components/logbook/entry-map-search";
import { BoundaryEditor, type BoundaryEditorHandle } from "./boundary-editor";
import { hasSitePoint, siteDraftSchema, type SiteEditorValue, type SiteDraft, type SitePoint } from "@/lib/sites/model";
import { validateSiteName } from "@/lib/sites/name";
import { validateBoundary } from "@/lib/sites/boundary";
import { radiusForKind } from "@/lib/sites/geo";
import { getSiteMapReferencesAction } from "@/app/settings/sites/editor-actions";
import { SiteUseIcon } from "@/components/icons/site-use-icon";

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
  const [boundaryDraft, setBoundaryDraft] = useState<unknown>(initial.boundary);
  const [references, setReferences] = useState<Awaited<ReturnType<typeof getSiteMapReferencesAction>>>([]);
  const [referenceError, setReferenceError] = useState(false);
  const otherSites = useMemo(() => references.filter(site => site.id !== initial.id), [references, initial.id]);
  useEffect(() => {
    let cancelled = false;
    getSiteMapReferencesAction().then(sites => { if (!cancelled) setReferences(sites); })
      .catch(() => { if (!cancelled) setReferenceError(true); });
    return () => { cancelled = true; };
  }, []);
  const onBoundaryChange = useCallback((draft: unknown) => setBoundaryDraft(draft), []);
  const map = useRef<BoundaryEditorHandle>(null);
  const point = { lat: lat.trim() ? Number(lat) : null, lon: lon.trim() ? Number(lon) : null };
  const mapped = hasSitePoint(point);
  const anchor = mapped ? point : flightPoint ?? { lat: 25, lon: 0 };
  const boundaryValidation = boundaryDraft !== null && mapped ? validateBoundary(boundaryDraft, "site", point) : null;
  const boundaryError = boundaryDraft !== null && (!mapped || boundaryValidation?.ok === false && boundaryValidation.error === "excludes_anchor")
    ? "Place the site pin inside the boundary before saving."
    : boundaryValidation?.ok === false ? `Check the boundary: ${boundaryValidation.error.replaceAll("_", " ")}.`
      : boundaryDraft === null && mode === "boundary" ? "Add at least 3 points." : null;
  const inputClass = "mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";
  function placePin(next: SitePoint) { setLat(String(Number(next.lat.toFixed(6)))); setLon(String(Number(next.lon.toFixed(6)))); }
  async function save() {
    setError(null);
    const raw = { ...value, ...point, boundary: map.current ? map.current.readDraft() : boundaryDraft };
    const shape = siteDraftSchema.safeParse(raw);
    if (!shape.success) { setError("Check the name and coordinates before saving."); return; }
    const name = validateSiteName(value.name);
    if (!name.ok) { setError("Enter a site name with 2–60 characters, using letters, numbers, spaces, or ordinary punctuation."); return; }
    if ((point.lat === null) !== (point.lon === null)) { setError("Enter both latitude and longitude, or leave both blank."); return; }
    if (value.visibility === "public" && !mapped) { setError("Add a map pin before sharing this site."); return; }
    if (raw.boundary !== null) {
      if (!mapped) return;
      const boundary = validateBoundary(raw.boundary, "site", point);
      if (!boundary.ok) return;
      raw.boundary = boundary.boundary;
    }
    setPending(true);
    try { await onSave({ ...raw, name: name.name }); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save the site. Your draft is still here."); }
    finally { setPending(false); }
  }
  return <section aria-label="Site editor" className="flex flex-col gap-2">
    <h2 className="font-condensed text-xl font-bold text-ink">{initial.id ? "Edit site" : "Create site"}</h2>
    {Boolean(usageCount && usageCount > 1) && <p className="text-xs text-gray-500">Used by {usageCount} of your flights.</p>}
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="col-span-2 min-w-0 text-xs font-medium text-gray-700 sm:col-span-1">Name<input value={value.name} maxLength={60} onChange={e => setValue({ ...value, name: e.target.value })} className={inputClass} /></label>
        <div><span className="block text-xs font-medium text-gray-700">Used for</span><div role="group" aria-label="Used for" className="mt-1 flex gap-1">
          {(["takeoff", "landing"] as const).map(kind => {
            const selected = value.kind === kind || value.kind === "both";
            return <button type="button" key={kind} aria-label={kind === "takeoff" ? "Takeoff" : "Landing"} title={kind === "takeoff" ? "Takeoff" : "Landing"} aria-pressed={selected}
              onClick={() => setValue({ ...value, kind: value.kind === "both" ? kind === "takeoff" ? "landing" : "takeoff" : selected ? kind : "both" })}
              className={`rounded-md border px-2 py-1.5 ${selected ? "border-brand-blue bg-brand-blue/15 text-brand-blue-strong" : "border-gray-300 text-gray-500 hover:bg-gray-100"}`}><SiteUseIcon landing={kind === "landing"} /></button>;
          })}
        </div></div>
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
      <EntryMapSearch compact sites={[]} onLocate={place => map.current?.locate(place)} />
      <div role="group" aria-label="Site editing tool" className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={mode === "anchor" ? "primary" : "outline"} aria-pressed={mode === "anchor"} onClick={() => setMode("anchor")}>Place or move pin</Button>
        <Button type="button" size="sm" variant={mode === "boundary" ? "primary" : "outline"} aria-pressed={mode === "boundary"} onClick={() => setMode("boundary")}>Draw or edit boundary</Button>
        {flightPoint && <Button type="button" variant="outline" onClick={() => { placePin(flightPoint); map.current?.locate(flightPoint); }}>Use this flight’s position</Button>}
      </div>
      <BoundaryEditor compact ref={map} anchor={anchor} anchorVisible={mapped} initialBoundary={initial.boundary} editingMode={mode} onAnchorChange={placePin}
        onDraftChange={onBoundaryChange} showValidation={false} siteName={value.name} showOtherSites nearby={otherSites}
        flightPoint={flightPoint} level="site" referenceRadiusM={mapped ? radiusForKind(value.kind === "landing" ? "landing" : "takeoff") : undefined}
        showSaveButton={false} showCancel={false} onSave={async () => ({ ok: true })} onClear={async () => ({ ok: true })} onCancel={onCancel} />
      {referenceError && <p role="status" className="text-xs text-orange-700">Other sites could not be loaded. Reopen the editor to try again.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-gray-700"><span className="shrink-0">Pin latitude:</span><input aria-label="Pin latitude" type="number" step="any" min={-90} max={90} value={lat} onChange={e => setLat(e.target.value)} className={`${inputClass} !mt-0 min-w-0`} /></label>
        <label className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-gray-700"><span className="shrink-0">Longitude:</span><input aria-label="Pin longitude" type="number" step="any" min={-180} max={180} value={lon} onChange={e => setLon(e.target.value)} className={`${inputClass} !mt-0 min-w-0`} /></label>
      </div>
    </fieldset>
    <div className="sticky bottom-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-paper py-2">
      <div>{(boundaryError || error) && <p role="alert" className="text-sm text-red-700">{boundaryError || error}</p>}</div>
      <div className="flex flex-col justify-end gap-2 sm:flex-row"><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={pending} onClick={() => void save()}>{pending ? "Saving…" : saveLabel}</Button></div>
    </div>
  </section>;
}
