"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { EntryDraft } from "@/lib/logbook/entry";
import type { EntrySite } from "@/lib/logbook/options";
import { hasSitePoint, newSiteDraft, siteDraftSchema, siteLocationLabel, type SiteEditorValue } from "@/lib/sites/model";
import { SiteDialog } from "@/components/flight/site-dialog";
import { SiteEditor } from "@/components/flight/site-editor";
import { isValidBoundaryShape } from "@/lib/sites/geo";

export function SiteField({ endpoint, label, value, sites, onChange }: {
  endpoint: "takeoff" | "landing"; label: string; value: EntryDraft; sites: EntrySite[]; onChange: (patch: Partial<EntryDraft>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const selected = sites.find(site => site.id === value[`${endpoint}SiteId`]);
  let staged: SiteEditorValue | null = null;
  try { if (value[`${endpoint}SiteDraft`]) {
    const draft = siteDraftSchema.parse(JSON.parse(value[`${endpoint}SiteDraft`]));
    staged = { ...draft, boundary: isValidBoundaryShape(draft.boundary) ? draft.boundary : null };
  } } catch { /* The server reports invalid staged data before a save. */ }
  const point = { lat: value[`${endpoint}Lat`] ? Number(value[`${endpoint}Lat`]) : null, lon: value[`${endpoint}Lon`] ? Number(value[`${endpoint}Lon`]) : null };
  const flightPoint = hasSitePoint(point) && value[`${endpoint}CoordinateMeaning`] !== "site" ? point : null;
  const initial: SiteEditorValue = staged ?? (selected ? {
    id: selected.id, expectedUpdatedAt: selected.updatedAt, name: selected.name, lat: selected.lat, lon: selected.lon,
    kind: selected.kind === "landing" || selected.kind === "both" ? selected.kind : "takeoff", visibility: selected.visibility === "public" ? "public" : "private", boundary: selected.boundary ?? null,
  } : newSiteDraft(value[`${endpoint}SiteName`], endpoint, hasSitePoint(point) ? point : null));
  const fieldClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";
  const choices = sites.filter(site => site.id === selected?.id || site.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="flex min-w-0 flex-col gap-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <input aria-label={`Search ${label.toLowerCase()}`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find an existing site" className={fieldClass} />
    <select aria-label={`Choose ${label.toLowerCase()}`} value={selected?.id ?? ""} className={fieldClass} onChange={event => {
      const site = sites.find(site => site.id === event.target.value);
      onChange({ [`${endpoint}SiteCleared`]: "", [`${endpoint}SiteId`]: site?.id ?? "", [`${endpoint}SiteName`]: site?.name ?? "", [`${endpoint}SiteDraft`]: "" });
    }}><option value="">Enter or create a site</option>{choices.map(site => <option key={site.id} value={site.id}>{site.name} · {siteLocationLabel(site)} · {site.visibility ?? "Available"}</option>)}</select>
    {!selected && !staged ? <input aria-label={`${label} name`} value={value[`${endpoint}SiteName`]} onChange={event => onChange({ [`${endpoint}SiteName`]: event.target.value, [`${endpoint}SiteCleared`]: "" })} placeholder="Site name (optional)" maxLength={200} className={fieldClass} />
      : <p className="text-sm text-gray-700">{initial.name} · {siteLocationLabel(initial, Boolean(flightPoint))}{staged ? " · Changes pending" : ""}</p>}
    <button type="button" onClick={() => setEditing(true)} className="self-start text-sm text-brand-blue-strong underline">{selected || staged || value[`${endpoint}SiteName`] ? "Edit site" : "Create site"}</button>
    {(selected || staged || value[`${endpoint}SiteName`]) && <button type="button" className="self-start text-sm text-gray-600 underline" onClick={() => onChange({ [`${endpoint}SiteCleared`]: "true", [`${endpoint}SiteId`]: "", [`${endpoint}SiteName`]: "", [`${endpoint}SiteDraft`]: "" })}>Remove site from this flight</button>}
    {value[`${endpoint}SiteCleared`] && <p className="text-xs text-gray-500">No site selected. Flight coordinates are kept.</p>}
    {editing && createPortal(<SiteDialog onClose={() => setEditing(false)}><SiteEditor initial={initial} pinSource={selected?.pinSource} flightPoint={flightPoint} canChangeVisibility={selected?.canEditVisibility ?? true}
      saveLabel="Done" onCancel={() => setEditing(false)} onSave={async draft => {
        onChange({ [`${endpoint}SiteCleared`]: "", [`${endpoint}SiteDraft`]: JSON.stringify(draft), [`${endpoint}SiteId`]: draft.id ?? "", [`${endpoint}SiteName`]: draft.name }); setEditing(false);
      }} /></SiteDialog>, document.body)}
  </div>;
}
