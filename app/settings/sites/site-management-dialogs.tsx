"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteDialog } from "@/components/flight/site-dialog";
import { hasSitePoint } from "@/lib/sites/model";
import type { ReplacementSite, SiteReplacementPreview } from "@/lib/sites/manage";
import type { SiteDeletionPreview } from "@/lib/sites/associate";
import { deleteSiteAction, previewDeleteSiteAction, previewSiteReplacementAction, replacementSitesAction, replaceSiteAction, type SiteManagerResult } from "./actions";

const flightLabel = (count: number) => `${count} flight${count === 1 ? "" : "s"}`;
type SiteChoice = { id: string; name: string };

export function ReplaceSiteDialog({ site, onClose, onReplaced }: {
  site: SiteChoice; onClose: () => void; onReplaced: (target: SiteChoice, count: number) => void;
}) {
  const [options, setOptions] = useState<SiteManagerResult<ReplacementSite[]> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<SiteReplacementPreview | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => { heading.current?.focus(); }, [preview]);
  useEffect(() => {
    let cancelled = false;
    replacementSitesAction(site.id).then(result => { if (!cancelled) setOptions(result); })
      .catch(() => { if (!cancelled) setOptions({ ok: false, error: "Could not load sites. Please try again." }); });
    return () => { cancelled = true; };
  }, [site.id, attempt]);
  const normalized = query.trim().toLocaleLowerCase();
  const choices = options?.ok ? options.value.filter(option => option.name.toLocaleLowerCase().includes(normalized)).sort((a, b) =>
    Number(b.name.toLocaleLowerCase().startsWith(normalized)) - Number(a.name.toLocaleLowerCase().startsWith(normalized)) || a.name.localeCompare(b.name)) : [];
  function choose(targetId: string) {
    startTransition(async () => {
      setError(null);
      try {
        const result = await previewSiteReplacementAction({ sourceId: site.id, targetId });
        if (result.ok) setPreview(result.value); else setError(result.error);
      } catch { setError("Could not preview this replacement. Please try again."); }
    });
  }
  function confirm() {
    if (!preview) return;
    startTransition(async () => {
      setError(null);
      try {
        const result = await replaceSiteAction({ sourceId: site.id, targetId: preview.target.id, revision: preview.revision });
        if (result.ok) onReplaced(preview.target, result.value.updated);
        else { setError(result.error); setPreview(null); }
      } catch { setError("Could not replace this site. Please try again."); }
    });
  }
  return <SiteDialog label="Replace site in your logbook" onClose={() => { if (!pending) onClose(); }}>
    <h2 ref={heading} tabIndex={-1} className="font-condensed text-2xl font-bold text-ink">Replace site in your logbook</h2>
    {preview ? <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-4 text-sm">
        <span className="min-w-0 break-words font-medium">{preview.source.name}</span><ArrowRight className="h-4 w-4 shrink-0 text-gray-500" aria-label="replaced by" /><span className="min-w-0 break-words font-medium text-brand-blue-strong">{preview.target.name}</span>
      </div>
      <p className="text-sm text-gray-700">Replace this site in <strong>{flightLabel(preview.flightCount)}</strong> in your logbook, across all pages.</p>
      <p className="text-sm text-gray-600">This updates {preview.takeoffCount} takeoff{preview.takeoffCount === 1 ? "" : "s"} and {preview.landingCount} landing{preview.landingCount === 1 ? "" : "s"}. Flight coordinates and all other flight details stay the same.</p>
      <p className="text-sm text-gray-600">Both sites stay unchanged. Other pilots’ flights are not affected.</p>
      {preview.flightCount === 0 && <p className="text-sm text-gray-600">No flights in your logbook use this site anymore.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" disabled={pending || !preview.flightCount} onClick={confirm}>{pending ? "Replacing…" : `Replace in ${flightLabel(preview.flightCount)}`}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setPreview(null)}>Choose another site</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
      </div>
    </> : <>
      <p className="text-sm text-gray-600">Choose the site to use instead of <strong>{site.name}</strong> on your flights.</p>
      <label className="relative"><span className="sr-only">Search replacement sites</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-500" aria-hidden="true" />
        <input type="search" value={query} disabled={pending} onChange={event => setQuery(event.target.value)} placeholder="Search your sites and public sites…" className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm" />
      </label>
      {!options && <p role="status" className="text-sm text-gray-500">Loading sites…</p>}
      {options && !options.ok && <div><p role="alert" className="text-sm text-red-700">{options.error}</p><Button type="button" variant="outline" onClick={() => { setOptions(null); setAttempt(value => value + 1); }}>Retry</Button></div>}
      {options?.ok && <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200" aria-label="Replacement sites">
        {choices.map(option => <button key={option.id} type="button" disabled={pending} onClick={() => choose(option.id)} className="flex min-h-11 w-full flex-wrap items-baseline gap-x-2 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-blue-50 disabled:opacity-50">
          <span className="min-w-0 break-words font-medium text-ink">{option.name}</span><span className="text-xs text-gray-500">{option.visibility === "public" ? "Public" : "Private"}{!hasSitePoint(option) && " · Name only"}</span>
        </button>)}
        {!choices.length && <p className="p-3 text-sm text-gray-500">{options.value.length ? "No matching sites." : "There are no other available sites. Create a site first."}</p>}
      </div>}
      {pending && <p role="status" className="text-sm text-gray-500">Preparing your confirmation…</p>}
      <Button type="button" variant="outline" className="self-start" onClick={onClose} disabled={pending}>Cancel</Button>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </SiteDialog>;
}

export function DeleteSiteDialog({ site, onClose, onDeleted }: { site: SiteChoice; onClose: () => void; onDeleted: () => void }) {
  const [loaded, setLoaded] = useState<SiteManagerResult<SiteDeletionPreview> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    previewDeleteSiteAction(site.id).then(result => { if (!cancelled) setLoaded(result); })
      .catch(() => { if (!cancelled) setLoaded({ ok: false, error: "Could not load site details. Please try again." }); });
    return () => { cancelled = true; };
  }, [site.id, attempt]);
  function confirm() {
    if (!loaded?.ok) return;
    startTransition(async () => {
      setError(null);
      try {
        const result = await deleteSiteAction({ siteId: site.id, revision: loaded.value.revision });
        if (result.ok) onDeleted(); else { setError(result.error); setLoaded(null); setAttempt(value => value + 1); }
      } catch { setError("Could not delete this site. Please try again."); }
    });
  }
  return <SiteDialog label="Delete site" onClose={() => { if (!pending) onClose(); }}>
    <h2 className="font-condensed text-2xl font-bold text-ink">Delete {loaded?.ok ? loaded.value.name : site.name}?</h2>
    {!loaded && <p role="status" className="text-sm text-gray-500">Checking site usage…</p>}
    {loaded && !loaded.ok && <p role="alert" className="text-sm text-red-700">{loaded.error}</p>}
    {loaded?.ok && <>
      <p className="text-sm text-gray-700">This permanently deletes the reusable site{loaded.value.flightCount ? ` and removes its connection to ${flightLabel(loaded.value.flightCount)} in your logbook` : ""}.</p>
      <p className="text-sm text-gray-600">Your flights and their recorded coordinates will be kept. To use another site on those flights, choose Replace site instead.</p>
      {loaded.value.zoneCount > 0 && <p className="text-sm text-gray-600">The site’s {loaded.value.zoneCount} saved zone{loaded.value.zoneCount === 1 ? "" : "s"} will also be deleted.</p>}
      <p className="text-sm font-medium text-gray-700">This cannot be undone.</p>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      {loaded?.ok && <Button type="button" variant="danger" onClick={confirm} disabled={pending}>{pending ? "Deleting…" : "Delete site"}</Button>}
      {loaded && !loaded.ok && <Button type="button" variant="outline" onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}>Refresh details</Button>}
      <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
    </div>
  </SiteDialog>;
}
