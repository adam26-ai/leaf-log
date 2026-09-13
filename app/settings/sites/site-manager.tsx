"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
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
import type { SiteVisibility } from "@/lib/sites/visibility";
import { siteLinkLabel } from "@/lib/sites/display";
import { SiteFlightList, SiteFlightSummary } from "./site-flight-list";
import {
  assignSiteFlightsAction,
  createSiteAction,
  moveSiteAnchorAction,
  previewSiteFlightsAction,
  setSiteVisibilityAction,
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

export function SiteManager({ sites }: { sites: ManagedSiteView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(sites[0]?.id ?? null);
  const selected = sites.find((site) => site.id === selectedId) ?? sites[0] ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const [createPoint, setCreatePoint] = useState<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });
  const [anchorDraft, setAnchorDraft] = useState<{ siteId: string; lat: number; lon: number } | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<SiteVisibility | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<BoundaryEditorInitialState | null | undefined>(undefined);
  const [editingMode, setEditingMode] = useState<"anchor" | "boundary">("anchor");
  const [candidates, setCandidates] = useState<SiteFlightCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reviewPage, setReviewPage] = useState(0);
  const [flightListRevision, setFlightListRevision] = useState(0);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getBoundaryForOwnedRow("site", selected.id).then(value => { if (!cancelled) setBoundary(value); }).catch(() => { if (!cancelled) setError("Could not load the site map. Reload this page to retry."); });
    return () => { cancelled = true; };
  }, [selected]);

  const anchorPoint = selected
    ? anchorDraft?.siteId === selected.id
      ? { lat: anchorDraft.lat, lon: anchorDraft.lon }
      : { lat: selected.lat, lon: selected.lon }
    : null;

  function chooseSite(siteId: string) {
    if (siteId === selected?.id) return;
    setSelectedId(siteId);
    setAnchorDraft(null);
    setVisibilityDraft(null);
    setBoundary(undefined);
    setEditingMode("anchor");
    setCandidates(null);
    setReviewPage(0);
    setChecked(new Set());
    setMessage(null);
    setError(null);
  }

  function setAnchorPoint(point: { lat: number; lon: number }) {
    if (selected) setAnchorDraft({ siteId: selected.id, ...point });
  }

  const candidateFlights = useMemo(() => {
    const groups = new Map<string, SiteFlightCandidate[]>();
    for (const candidate of candidates ?? []) {
      const matches = groups.get(candidate.id) ?? [];
      matches.push(candidate);
      groups.set(candidate.id, matches);
    }
    return [...groups.values()];
  }, [candidates]);
  const shownFlights = candidateFlights.slice(reviewPage * 25, (reviewPage + 1) * 25);
  const shownKeys = shownFlights.flat().map(candidateKey);
  const selectedFlightCount = new Set((candidates ?? []).filter(candidate => checked.has(candidateKey(candidate))).map(candidate => candidate.id)).size;

  function changeReviewPage(page: number) {
    setReviewPage(page);
  }

  function run(task: () => Promise<void>) {
    setMessage(null);
    setError(null);
    startTransition(async () => { try { await task(); } catch { setError("Could not save changes. Please try again."); } });
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
      setCandidates(null);
      setMessage("Site anchor updated. Existing flight coordinates were not changed.");
      router.refresh();
    });
  }

  function saveVisibility() {
    if (!selected || !visibilityDraft) return;
    run(async () => {
      const result = await setSiteVisibilityAction({ siteId: selected.id, visibility: visibilityDraft });
      if (!result.ok) return setError(result.error);
      setVisibilityDraft(null);
      setMessage(`${selected.name} is now ${visibilityDraft}.`);
      router.refresh();
    });
  }

  function previewFlights() {
    if (!selected) return;
    run(async () => {
      const result = await previewSiteFlightsAction(selected.id);
      if (!result.ok) return setError(result.error);
      setCandidates(result.value);
      setReviewPage(0);
      setChecked(new Set());
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
      setMessage(`${selected.name} assigned to ${result.value.updated} flight${result.value.updated === 1 ? "" : "s"}.`);
      setChecked(new Set());
      setReviewPage(0);
      setFlightListRevision(value => value + 1);
      setCandidates(null);
      router.refresh();
      const refreshed = await previewSiteFlightsAction(selected.id);
      if (refreshed.ok) setCandidates(refreshed.value);
      else setError("The site was assigned, but matches could not be refreshed. Try finding matches again.");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-6">
        <Card className="overflow-hidden">
          <button
            type="button"
            aria-expanded={createOpen}
            aria-controls="create-site-panel"
            onClick={() => setCreateOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 p-5 text-left hover:bg-gray-50"
          >
            <span className="font-condensed text-xl font-bold text-ink">Create a site</span>
            <ChevronDown className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${createOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {createOpen && <div id="create-site-panel" className="border-t border-gray-200 p-5">
            <p className="mb-4 text-sm text-gray-600">No flight or IGC file is required. Click the map to place the site anchor.</p>
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
          </div>}
        </Card>

        <Card className="p-3">
          <h2 className="px-2 pb-2 font-condensed text-xl font-bold text-ink">Your sites</h2>
          {sites.length === 0 ? <p className="px-2 pb-2 text-sm text-gray-500">You have not created any sites yet.</p> : (
            <div className="flex flex-col gap-1">
              {sites.map((site) => <button key={site.id} type="button" disabled={pending} onClick={() => chooseSite(site.id)} className={`rounded-md px-3 py-2 text-left text-sm ${site.id === selected?.id ? "bg-blue-50 text-ink ring-1 ring-brand-blue" : "hover:bg-gray-50"}`}>
                <span className="block font-semibold">{site.name}</span>
                <span className="text-xs text-gray-500">{site.kind} · {site.visibility} · {site.ownFlightCount} flight{site.ownFlightCount === 1 ? "" : "s"}</span>
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
            <div className="mt-4 border-b border-gray-200 pb-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm font-medium text-gray-700">
                  Site visibility
                  <select
                    className={`${inputClass} mt-1.5`}
                    value={visibilityDraft ?? selected.visibility}
                    onChange={(event) => setVisibilityDraft(event.target.value === "public" ? "public" : "private")}
                    disabled={pending}
                    aria-describedby="site-visibility-help"
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <Button type="button" variant="outline" onClick={saveVisibility} disabled={pending || !visibilityDraft || visibilityDraft === selected.visibility}>Save visibility</Button>
              </div>
              <p id="site-visibility-help" className="mt-2 text-xs text-gray-500">
                Private sites are visible only to you. Public sites can be seen and used by other pilots.
                A site must stay public while other pilots’ flights use it or it has their contributions.
              </p>
            </div>
            <p className="mt-4 text-sm text-gray-600">The anchor describes the site. It is separate from every flight’s recorded takeoff or landing coordinates.</p>
            {anchorPoint && <div className="mt-4 flex flex-col gap-3">
              <div role="group" aria-label="Site editing tool" className="flex gap-2">
                <Button type="button" variant="outline" className="aria-pressed:border-brand-blue aria-pressed:bg-blue-50 aria-pressed:text-brand-blue-strong" aria-pressed={editingMode === "anchor"} onClick={() => setEditingMode("anchor")}>Move site pin</Button>
                <Button type="button" variant="outline" className="aria-pressed:border-brand-blue aria-pressed:bg-blue-50 aria-pressed:text-brand-blue-strong" aria-pressed={editingMode === "boundary"} onClick={() => setEditingMode("boundary")} disabled={anchorPoint.lat !== selected.lat || anchorPoint.lon !== selected.lon}>{selected.hasBoundary ? "Edit boundary" : "Draw boundary"}</Button>
              </div>
              {boundary ? <BoundaryEditor
                key={`${selected.id}:${JSON.stringify(boundary.boundary)}`}
                anchor={anchorPoint} initialBoundary={boundary.boundary} level="site"
                editingMode={editingMode} onAnchorChange={setAnchorPoint}
                referenceRadiusM={radiusForKind(selected.kind === "landing" ? "landing" : "takeoff")} nearby={boundary.nearby}
                onSave={raw => saveBoundaryForOwnedRow("site", selected.id, raw)}
                onClear={() => clearBoundaryForOwnedRow("site", selected.id)}
                onCancel={() => setEditingMode("anchor")} showCancel={false} saveLabel="Save boundary"
                onSaved={async () => { setBoundary(await getBoundaryForOwnedRow("site", selected.id)); setCandidates(null); setMessage("Boundary updated. No flights were reassigned."); router.refresh(); }}
              /> : <p className="text-sm text-gray-500">{boundary === null ? "This site is unavailable to edit." : "Loading site map..."}</p>}
              {editingMode === "anchor" && <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-gray-700">Latitude<input type="number" step="any" min={-90} max={90} value={anchorPoint.lat} onChange={(event) => setAnchorPoint({ ...anchorPoint, lat: Number(event.target.value) })} className={`${inputClass} mt-1.5`} /></label>
                <label className="text-sm font-medium text-gray-700">Longitude<input type="number" step="any" min={-180} max={180} value={anchorPoint.lon} onChange={(event) => setAnchorPoint({ ...anchorPoint, lon: Number(event.target.value) })} className={`${inputClass} mt-1.5`} /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={moveAnchor} disabled={pending || (anchorPoint.lat === selected.lat && anchorPoint.lon === selected.lon)}>Save anchor</Button>

              </div>
              </>}
              {selected.hasBoundary && <p className="text-xs text-gray-500">To move the anchor outside the saved boundary, remove the boundary first, save the anchor, then redraw it.</p>}
            </div>}
          </Card>

          <SiteFlightList key={`${selected.id}:${flightListRevision}`} siteId={selected.id} count={selected.ownFlightCount} revision={flightListRevision} />

          <Card className="p-5">
            <section aria-labelledby="review-flights-heading">
            <h3 id="review-flights-heading" className="font-condensed text-xl font-bold text-ink">Review matching flights</h3>
            <p className="mt-1 text-sm text-gray-600">Find other flights using coordinates inside this site’s boundary or matching radius. Flights already linked here appear above.</p>
            <p className="mt-2 text-xs text-gray-500">A <strong>Linked site</strong> is a site saved in Leaf Log. <strong>Name only</strong> is a label on a flight, with no site linked. Coordinates can be recorded, imported, or entered manually.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={previewFlights} disabled={pending}>{candidates ? "Refresh matches" : "Find matching flights"}</Button>
            {candidates?.length === 0 && <p className="mt-4 text-sm text-gray-500">No additional flights match this site’s boundary or radius. Flights with only a name and no coordinates cannot be matched here.</p>}
            {candidates && candidates.length > 0 && <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                <span>{candidateFlights.length} matching flight{candidateFlights.length === 1 ? "" : "s"}</span>
                <button type="button" className="underline disabled:opacity-50" disabled={pending || new Set([...checked, ...shownKeys]).size > 200} onClick={() => setChecked(current => new Set([...current, ...shownKeys]))}>Select all on this page</button>
              </div>
              <ul className="max-h-[32rem] overflow-y-auto rounded-md border border-gray-200">
                {shownFlights.map(matches => <li key={matches[0].id} className="border-b border-gray-200 p-3 text-sm last:border-0">
                  <SiteFlightSummary flight={matches[0]} />
                  <div className="mt-2 flex flex-col gap-2">
                    {matches.map(candidate => {
                      const key = candidateKey(candidate);
                      const label = candidate.currentSiteState === "unavailable" ? "Unavailable site" : siteLinkLabel(candidate.currentSiteId, candidate.currentSiteName);
                      return <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md bg-gray-50 p-2.5 hover:bg-blue-50/40">
                        <input type="checkbox" className="mt-1" checked={checked.has(key)} disabled={pending || (!checked.has(key) && checked.size >= 200)} onChange={(event) => setChecked(current => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{candidate.endpoint === "takeoff" ? "Takeoff" : "Landing"} <span className="font-normal text-gray-500">· {Math.round(candidate.distanceM)} m from site pin</span></span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${candidate.currentSiteState === "linked" ? "bg-blue-100 text-brand-blue-strong" : "bg-gray-200 text-gray-700"}`}>{label}</span><span className="break-words text-xs text-gray-600">{candidate.currentSiteName}</span></span>
                          {candidate.currentSiteState === "linked" && <span className="mt-1 block text-xs text-gray-500">Currently linked to a different site{candidate.currentSiteName === selected.name ? " with the same name" : ""}. Selecting this replaces that link.</span>}
                        </span>
                      </label>;
                    })}
                  </div>
                </li>)}
              </ul>
              {candidateFlights.length > 25 && <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                <Button type="button" variant="outline" size="sm" disabled={pending || reviewPage === 0} onClick={() => changeReviewPage(reviewPage - 1)}>Previous matches</Button>
                <span>Page {reviewPage + 1} of {Math.ceil(candidateFlights.length / 25)}</span>
                <Button type="button" variant="outline" size="sm" disabled={pending || (reviewPage + 1) * 25 >= candidateFlights.length} onClick={() => changeReviewPage(reviewPage + 1)}>Next matches</Button>
              </div>}
              <p className="mt-2 text-xs text-gray-600">Assign <strong>{selected.name}</strong> to the selected takeoffs and landings. This replaces their current site links or names. Flight coordinates stay the same.</p>
              {checked.size >= 200 && <p className="text-xs text-gray-600">You can assign up to 200 takeoffs and landings at a time. Save this selection before choosing more.</p>}
              <Button type="button" className="whitespace-normal" onClick={assignFlights} disabled={pending || checked.size === 0}>{selectedFlightCount ? `Assign site to ${selectedFlightCount} selected flight${selectedFlightCount === 1 ? "" : "s"}` : "Assign site to selected flights"}</Button>
            </div>}
            </section>
          </Card>
        </>}
      </div>
    </div>
  );
}
