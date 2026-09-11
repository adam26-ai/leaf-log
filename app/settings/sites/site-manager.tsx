"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BoundaryEditor } from "@/components/flight/boundary-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  clearBoundaryForOwnedRow,
  getBoundaryForOwnedRow,
  saveBoundaryForOwnedRow,
  type BoundaryEditorInitialState,
} from "@/app/flights/[id]/boundary-action";
import { radiusForKind } from "@/lib/sites/geo";
import type { SiteFlightCandidate } from "@/lib/sites/manage";
import {
  assignSiteFlightsAction,
  createSiteAction,
  moveSiteAnchorAction,
  previewSiteFlightsAction,
} from "./actions";

const EntryMap = dynamic(() => import("@/components/logbook/entry-map").then((module) => module.EntryMap), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-gray-500">Loading map…</p>,
});

type ManagedSiteView = {
  id: string;
  name: string;
  kind: "takeoff" | "landing" | "both";
  visibility: string;
  lat: number;
  lon: number;
  updatedAt: string;
  hasBoundary: boolean;
  ownFlightCount: number;
};

const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";

function candidateKey(candidate: Pick<SiteFlightCandidate, "id" | "endpoint">) {
  return `${candidate.id}:${candidate.endpoint}`;
}

function sourceLabel(source: string) {
  return source === "csv_import" ? "CSV import" : source === "manual_entry" ? "Manual" : "IGC";
}

export function SiteManager({ sites }: { sites: ManagedSiteView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(sites[0]?.id ?? null);
  const selected = sites.find((site) => site.id === selectedId) ?? sites[0] ?? null;
  const [createPoint, setCreatePoint] = useState<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });
  const [anchorDraft, setAnchorDraft] = useState<{ siteId: string; lat: number; lon: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<BoundaryEditorInitialState | null | undefined>(undefined);
  const [candidates, setCandidates] = useState<SiteFlightCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const anchorPoint = selected
    ? anchorDraft?.siteId === selected.id
      ? { lat: anchorDraft.lat, lon: anchorDraft.lon }
      : { lat: selected.lat, lon: selected.lon }
    : null;

  function chooseSite(siteId: string) {
    setSelectedId(siteId);
    setAnchorDraft(null);
    setBoundary(undefined);
    setCandidates(null);
    setChecked(new Set());
    setMessage(null);
    setError(null);
  }

  function setAnchorPoint(point: { lat: number; lon: number }) {
    if (selected) setAnchorDraft({ siteId: selected.id, ...point });
  }

  const assignable = useMemo(
    () => candidates?.filter((candidate) => candidate.currentSiteId !== selectedId) ?? [],
    [candidates, selectedId],
  );

  function run(task: () => Promise<void>) {
    setMessage(null);
    setError(null);
    startTransition(() => void task());
  }

  function createSite(formData: FormData) {
    run(async () => {
      const result = await createSiteAction({
        name: String(formData.get("name") ?? ""),
        kind: String(formData.get("kind") ?? "takeoff"),
        visibility: formData.get("visibility") === "public" ? "public" : "private",
        lat: createPoint.lat ?? Number.NaN,
        lon: createPoint.lon ?? Number.NaN,
      });
      if (!result.ok) return setError(result.error);
      chooseSite(result.value.id);
      setMessage("Site created. You can now move its anchor, draw a boundary, and review matching flights.");
      router.refresh();
    });
  }

  function moveAnchor() {
    if (!selected || !anchorPoint) return;
    run(async () => {
      const result = await moveSiteAnchorAction({ siteId: selected.id, ...anchorPoint });
      if (!result.ok) return setError(result.error);
      setMessage("Site anchor updated. Existing flight coordinates were not changed.");
      router.refresh();
    });
  }

  function editBoundary() {
    if (!selected) return;
    run(async () => {
      const value = await getBoundaryForOwnedRow("site", selected.id);
      if (!value) return setError("This site is not available to edit.");
      setBoundary(value);
    });
  }

  function previewFlights() {
    if (!selected) return;
    run(async () => {
      const result = await previewSiteFlightsAction(selected.id);
      if (!result.ok) return setError(result.error);
      setCandidates(result.value);
      setChecked(new Set());
      setMessage(result.value.length === 0 ? "No flight coordinates fall within this site's boundary or matching radius." : null);
    });
  }

  function assignFlights() {
    if (!selected || !candidates) return;
    const selections = candidates
      .filter((candidate) => checked.has(candidateKey(candidate)))
      .map(({ id, endpoint }) => ({ id, endpoint }));
    run(async () => {
      const result = await assignSiteFlightsAction({ siteId: selected.id, selections });
      if (!result.ok) return setError(result.error);
      setMessage(`${result.value.updated} flight location${result.value.updated === 1 ? "" : "s"} assigned to ${selected.name}.`);
      setChecked(new Set());
      router.refresh();
      const refreshed = await previewSiteFlightsAction(selected.id);
      if (refreshed.ok) setCandidates(refreshed.value);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <h2 className="font-condensed text-xl font-bold text-ink">Create a site</h2>
          <p className="mb-4 mt-1 text-sm text-gray-600">No flight or IGC file is required. Click the map to place the site anchor.</p>
          <form action={createSite} className="flex flex-col gap-3">
            <label className="text-sm font-medium text-gray-700">Name<input name="name" required maxLength={120} className={`${inputClass} mt-1.5`} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium text-gray-700">Kind<select name="kind" className={`${inputClass} mt-1.5`} defaultValue="takeoff"><option value="takeoff">Takeoff</option><option value="landing">Landing</option><option value="both">Both</option></select></label>
              <label className="text-sm font-medium text-gray-700">Visibility<select name="visibility" className={`${inputClass} mt-1.5`} defaultValue="private"><option value="private">Private</option><option value="public">Public</option></select></label>
            </div>
            <EntryMap lat={createPoint.lat} lon={createPoint.lon} label="New site anchor" draggable onPick={(lat, lon) => setCreatePoint({ lat, lon })} />
            {createPoint.lat != null && <p className="text-xs text-gray-500">Anchor: {createPoint.lat.toFixed(6)}, {createPoint.lon?.toFixed(6)}</p>}
            <Button type="submit" disabled={pending || createPoint.lat == null || createPoint.lon == null}>Create site</Button>
          </form>
        </Card>

        <Card className="p-3">
          <h2 className="px-2 pb-2 font-condensed text-xl font-bold text-ink">Your sites</h2>
          {sites.length === 0 ? <p className="px-2 pb-2 text-sm text-gray-500">You have not created any sites yet.</p> : (
            <div className="flex flex-col gap-1">
              {sites.map((site) => <button key={site.id} type="button" onClick={() => chooseSite(site.id)} className={`rounded-md px-3 py-2 text-left text-sm ${site.id === selected?.id ? "bg-blue-50 text-ink ring-1 ring-brand-blue" : "hover:bg-gray-50"}`}>
                <span className="block font-semibold">{site.name}</span>
                <span className="text-xs text-gray-500">{site.kind} · {site.visibility} · {site.ownFlightCount} flight location{site.ownFlightCount === 1 ? "" : "s"}</span>
              </button>)}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
        {!selected ? <Card className="p-6 text-sm text-gray-500">Create a site to start mapping it.</Card> : <>
          <Card className="p-5">
            <h2 className="font-condensed text-2xl font-bold text-ink">{selected.name}</h2>
            <p className="mt-1 text-sm text-gray-600">The anchor describes the site. It is separate from every flight’s recorded takeoff or landing coordinates.</p>
            {anchorPoint && <div className="mt-4 flex flex-col gap-3">
              <EntryMap lat={anchorPoint.lat} lon={anchorPoint.lon} label={`${selected.name} anchor`} draggable onPick={(lat, lon) => setAnchorPoint({ lat, lon })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-gray-700">Latitude<input type="number" step="any" min={-90} max={90} value={anchorPoint.lat} onChange={(event) => setAnchorPoint({ ...anchorPoint, lat: Number(event.target.value) })} className={`${inputClass} mt-1.5`} /></label>
                <label className="text-sm font-medium text-gray-700">Longitude<input type="number" step="any" min={-180} max={180} value={anchorPoint.lon} onChange={(event) => setAnchorPoint({ ...anchorPoint, lon: Number(event.target.value) })} className={`${inputClass} mt-1.5`} /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={moveAnchor} disabled={pending || (anchorPoint.lat === selected.lat && anchorPoint.lon === selected.lon)}>Save anchor</Button>
                <Button type="button" variant="outline" onClick={editBoundary} disabled={pending}>{selected.hasBoundary ? "Edit boundary" : "Draw boundary"}</Button>
              </div>
              {selected.hasBoundary && <p className="text-xs text-gray-500">To move the anchor outside the saved boundary, remove the boundary first, save the anchor, then redraw it.</p>}
            </div>}
          </Card>

          {boundary && <Card className="p-5">
            <div className="mb-4">
              <h3 className="font-condensed text-xl font-bold text-ink">Boundary for {selected.name}</h3>
              <p className="mt-1 text-sm text-gray-600">The shape must include the movable site anchor. Saving it does not reassign any flights.</p>
            </div>
            <BoundaryEditor
              key={`${selected.id}:${boundary.anchor.lat}:${boundary.anchor.lon}:${JSON.stringify(boundary.boundary)}`}
              anchor={boundary.anchor}
              initialBoundary={boundary.boundary}
              level="site"
              referenceRadiusM={radiusForKind(selected.kind === "landing" ? "landing" : "takeoff")}
              nearby={boundary.nearby}
              onSave={(raw) => saveBoundaryForOwnedRow("site", selected.id, raw)}
              onClear={() => clearBoundaryForOwnedRow("site", selected.id)}
              onCancel={() => setBoundary(undefined)}
              onSaved={() => { setBoundary(undefined); setMessage("Boundary updated. No flights were reassigned."); router.refresh(); }}
            />
          </Card>}

          <Card className="p-5">
            <h3 className="font-condensed text-xl font-bold text-ink">Review matching flights</h3>
            <p className="mt-1 text-sm text-gray-600">Preview uses each flight’s stored coordinates. Select the exact rows to change; names and assignments outside this selection stay untouched.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={previewFlights} disabled={pending}>Preview matches</Button>
            {candidates && candidates.length > 0 && <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-xs text-gray-500"><span>{assignable.length} available to assign; {candidates.length - assignable.length} already assigned</span><button type="button" className="underline" onClick={() => setChecked(new Set(assignable.map(candidateKey)))}>Select all available</button></div>
              <div className="max-h-96 overflow-auto rounded-md border border-gray-200">
                {candidates.map((candidate) => {
                  const key = candidateKey(candidate);
                  const alreadyAssigned = candidate.currentSiteId === selected.id;
                  return <label key={key} className={`flex items-start gap-3 border-b border-gray-100 p-3 text-sm last:border-0 ${alreadyAssigned ? "bg-gray-50 text-gray-500" : "hover:bg-blue-50/40"}`}>
                    <input type="checkbox" className="mt-1" checked={alreadyAssigned || checked.has(key)} disabled={alreadyAssigned || pending} onChange={(event) => setChecked((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />
                    <span className="min-w-0 flex-1"><span className="font-medium text-ink">{candidate.date ?? "Undated flight"} · {candidate.endpoint}</span><span className="block text-xs text-gray-500">{sourceLabel(candidate.source)} · {Math.round(candidate.distanceM)} m from anchor · current: {alreadyAssigned ? selected.name : candidate.currentSiteName || "Unassigned"}</span></span>
                    <Link href={`/flights/${candidate.id}`} className="text-xs text-brand-blue-strong underline">View</Link>
                  </label>;
                })}
              </div>
              <Button type="button" onClick={assignFlights} disabled={pending || checked.size === 0}>Assign {checked.size || "selected"}</Button>
            </div>}
          </Card>
        </>}
      </div>
    </div>
  );
}
