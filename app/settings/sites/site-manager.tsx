"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SiteDialog } from "@/components/flight/site-dialog";
import { PersistedSiteEditor } from "@/components/flight/persisted-site-editor";
import { siteLinkLabel } from "@/lib/sites/display";
import { siteLocationLabel } from "@/lib/sites/model";
import { previewSiteFlightsAction, assignSiteFlightsAction } from "./actions";
import type { SiteFlightCandidate } from "@/lib/sites/manage";
import { SiteFlightList, SiteFlightSummary } from "./site-flight-list";

type ManagedSiteView = { id: string; name: string; kind: "takeoff" | "landing" | "both"; visibility: string;
  lat: number | null; lon: number | null; updatedAt: string; hasBoundary: boolean; hasLocationEvidence?: boolean; ownFlightCount: number };
const candidateKey = (row: SiteFlightCandidate) => row.id + ":" + row.endpoint;

export function SiteManager({ sites }: { sites: ManagedSiteView[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(sites[0]?.id ?? null);
  const selected = sites.find(site => site.id === selectedId) ?? sites[0] ?? null;
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [candidates, setCandidates] = useState<SiteFlightCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  function choose(id: string) { setSelectedId(id); setCandidates(null); setChecked(new Set()); setPage(0); setError(null); setMessage(null); }
  function preview() {
    if (!selected) return;
    startTransition(async () => {
      setError(null);
      try { const result = await previewSiteFlightsAction(selected.id);
        if (!result.ok) { setError(result.error); return; }
        setCandidates(result.value); setPage(0); setChecked(new Set());
      } catch { setError("Could not load matching flights. Please try again."); }
    });
  }
  function assign() {
    if (!selected || !candidates) return;
    const selections = candidates.filter(row => checked.has(candidateKey(row))).map(({id,endpoint}) => ({id,endpoint}));
    startTransition(async () => {
      setError(null);
      try { const result = await assignSiteFlightsAction({siteId:selected.id,selections});
        if (!result.ok) { setError(result.error); return; }
        setCandidates(null); setChecked(new Set()); setRevision(n => n+1);
        setMessage(`${selected.name} assigned to ${result.value.updated} flights. Flight coordinates were preserved.`); router.refresh();
        const refreshed = await previewSiteFlightsAction(selected.id); if (refreshed.ok) setCandidates(refreshed.value);
      } catch { setError("Could not save these selections. Please try again."); }
    });
  }
  const candidateFlights = useMemo(() => {
    const grouped = new Map<string, SiteFlightCandidate[]>();
    for (const row of candidates ?? []) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
    return [...grouped.values()];
  }, [candidates]);
  const shownFlights = candidateFlights.slice(page * 25, (page + 1) * 25);
  const shownKeys = shownFlights.flat().map(candidateKey);
  const selectedFlightCount = new Set((candidates ?? []).filter(row => checked.has(candidateKey(row))).map(row => row.id)).size;
  return <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
    <div className="flex flex-col gap-4">
      <Button type="button" onClick={() => setEditor("create")}>Create a site</Button>
      <Card className="p-3"><h2 className="px-2 pb-2 font-condensed text-xl font-bold">Sites in your logbook</h2>
        <p className="px-2 pb-3 text-xs text-gray-600">Your sites and public sites you use. Every site has the same editing tools.</p>
        {sites.length ? sites.map(site => <button key={site.id} type="button" onClick={() => choose(site.id)} aria-pressed={site.id === selected?.id}
          className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-50 aria-pressed:bg-blue-50">
          <span className="block font-semibold">{site.name}</span><span className="text-xs text-gray-600">{siteLocationLabel(site, site.hasLocationEvidence)} · {site.visibility} · {site.ownFlightCount} flight{site.ownFlightCount === 1 ? "" : "s"}</span>
        </button>) : <p className="p-2 text-sm text-gray-600">Create a site or import your logbook to get started.</p>}
      </Card>
    </div>
    <div className="flex flex-col gap-5">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-800">{message}</p>}
      {selected && <>
        <Card className="p-5"><h2 className="font-condensed text-2xl font-bold">{selected.name}</h2>
          <p className="my-3 text-sm text-gray-600">{siteLocationLabel(selected, selected.hasLocationEvidence)} · {selected.visibility}{selected.hasBoundary ? " · Boundary added" : ""}</p>
          <Button type="button" onClick={() => setEditor("edit")}>Edit site</Button>
        </Card>
        <SiteFlightList key={selected.id + ":" + revision} siteId={selected.id} count={selected.ownFlightCount} revision={revision} />
        <Card className="p-5">
            <section aria-labelledby="review-flights-heading">
            <h3 id="review-flights-heading" className="font-condensed text-xl font-bold text-ink">Review matching flights</h3>
            <p className="mt-1 text-sm text-gray-600">Find other flights using coordinates inside this site’s boundary or matching radius. Flights that use this site appear above.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={preview} disabled={pending || selected.lat === null}>{candidates ? "Refresh matches" : "Find matching flights"}</Button>
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
                      const label = candidate.currentSiteState === "unavailable" ? "Unavailable site" : siteLinkLabel(candidate.currentSiteId, candidate.currentSiteName, candidate.currentSiteMapped, true, candidate.assignment === "needs_review");
                      return <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md bg-gray-50 p-2.5 hover:bg-blue-50/40">
                        <input type="checkbox" className="mt-1" checked={checked.has(key)} disabled={pending || (!checked.has(key) && checked.size >= 200)} onChange={(event) => setChecked(current => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{candidate.endpoint === "takeoff" ? "Takeoff" : "Landing"} <span className="font-normal text-gray-500">· {Math.round(candidate.distanceM)} m from site pin</span></span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${candidate.currentSiteState === "linked" ? "bg-blue-100 text-brand-blue-strong" : "bg-gray-200 text-gray-700"}`}>{label}</span><span className="break-words text-xs text-gray-600">{candidate.currentSiteName}</span></span>
                          {candidate.currentSiteState === "linked" && <span className="mt-1 block text-xs text-gray-500">Currently uses a different site{candidate.currentSiteName === selected.name ? " with the same name" : ""}. Selecting this changes the site for this flight.</span>}
                        </span>
                      </label>;
                    })}
                  </div>
                </li>)}
              </ul>
              {candidateFlights.length > 25 && <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                <Button type="button" variant="outline" size="sm" disabled={pending || page === 0} onClick={() => setPage(page - 1)}>Previous matches</Button>
                <span>Page {page + 1} of {Math.ceil(candidateFlights.length / 25)}</span>
                <Button type="button" variant="outline" size="sm" disabled={pending || (page + 1) * 25 >= candidateFlights.length} onClick={() => setPage(page + 1)}>Next matches</Button>
              </div>}
              <p className="mt-2 text-xs text-gray-600">Assign <strong>{selected.name}</strong> to the selected takeoffs and landings. This replaces their current site selection or name. Flight coordinates stay the same.</p>
              {checked.size >= 200 && <p className="text-xs text-gray-600">You can assign up to 200 takeoffs and landings at a time. Save this selection before choosing more.</p>}
              <Button type="button" className="whitespace-normal" onClick={assign} disabled={pending || checked.size === 0}>{selectedFlightCount ? `Assign site to ${selectedFlightCount} selected flight${selectedFlightCount === 1 ? "" : "s"}` : "Assign site to selected flights"}</Button>
            </div>}
            </section>
          </Card>
      </>}
    </div>
    {editor && <SiteDialog onClose={()=>setEditor(null)}><PersistedSiteEditor context={editor === "create" ? {create:true} : {siteId:selected?.id}}
      onCancel={()=>setEditor(null)} onSaved={site=>{choose(site.id);setEditor(null);setRevision(n=>n+1);router.refresh();}} /></SiteDialog>}
  </div>;
}
