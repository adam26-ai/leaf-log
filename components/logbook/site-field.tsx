"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Plus, Search } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const focusAfterChoice = useRef(false);
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
  const hasSelection = Boolean(selected || staged || value[`${endpoint}SiteName`]);
  const isNew = !selected && !staged?.id;
  const picking = !hasSelection || changing;
  const query = search.trim();
  const normalized = query.toLocaleLowerCase();
  const choices = sites.filter(site => site.name.toLocaleLowerCase().includes(normalized)).sort((a, b) =>
    Number(b.name.toLocaleLowerCase().startsWith(normalized)) - Number(a.name.toLocaleLowerCase().startsWith(normalized))
    || Number(b.previous) - Number(a.previous) || a.name.localeCompare(b.name));
  const optionCount = choices.length + Number(Boolean(query));

  useEffect(() => {
    if (focusAfterChoice.current) {
      (picking ? input.current : changeButton.current)?.focus();
      focusAfterChoice.current = false;
    }
  }, [picking]);
  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${uid}-option-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, uid]);

  function choose(site?: EntrySite) {
    if (!site && !query) return;
    // A name-only choice keeps the existing save-time matching and coordinate
    // rules. Search text itself never enters the flight draft.
    onChange({ [`${endpoint}SiteCleared`]: "", [`${endpoint}SiteId`]: site?.id ?? "", [`${endpoint}SiteName`]: site?.name ?? query, [`${endpoint}SiteDraft`]: "" });
    focusAfterChoice.current = true;
    setChanging(false); setOpen(false); setSearch(""); setActiveIndex(-1);
  }
  function dismiss() {
    setOpen(false); setActiveIndex(-1);
    if (changing) { focusAfterChoice.current = true; setChanging(false); }
  }
  const fieldClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25";
  const optionClass = (index: number) => `flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-brand-blue/10 [@media(pointer:coarse)]:min-h-11 ${activeIndex === index ? "bg-brand-blue/10" : ""}`;
  return <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-2">
    <label id={`${uid}-label`} htmlFor={picking ? `${uid}-search` : undefined} className="text-sm font-medium text-gray-700">{label} <span className="font-normal text-gray-400">(optional)</span></label>
    {picking ? <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) dismiss(); }}>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-500" />
        <input ref={input} id={`${uid}-search`} role="combobox" type="search" aria-label={`Search ${label.toLowerCase()}`} aria-autocomplete="list"
          aria-expanded={open} aria-controls={open ? `${uid}-results` : undefined} aria-activedescendant={open && activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined}
          value={search} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} autoComplete="off" maxLength={200}
          onChange={event => { setSearch(event.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActiveIndex(index => optionCount ? (index + (event.key === "ArrowDown" ? 1 : index < 0 ? 0 : -1) + optionCount) % optionCount : -1);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (open && activeIndex >= 0 && activeIndex < optionCount) choose(choices[activeIndex]);
            }
          }} placeholder="Search or enter a site name…" className={`${fieldClass} pl-9`} />
      </div>
      {open && <div className="mt-1 rounded-lg border border-gray-200 bg-white p-1">
        <p className="px-3 py-2 text-xs text-gray-500">{choices.length ? query ? "Matching sites" : "Your sites and public sites" : query ? "No matching sites" : "No sites available yet. Enter a name to add one."}</p>
        <div id={`${uid}-results`} role="listbox" aria-labelledby={`${uid}-label`} className="max-h-64 overflow-y-auto">
          {choices.map((site, index) => <button key={site.id} id={`${uid}-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(site)} className={optionClass(index)}>
            <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" /><span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2"><span className="break-words font-medium text-ink">{site.name}</span><span className="text-xs text-gray-500">{site.visibility === "public" ? "Public" : "Private"}{!hasSitePoint(site) && " · Name only"}</span></span>
          </button>)}
          {query && <button id={`${uid}-option-${choices.length}`} type="button" role="option" aria-selected={activeIndex === choices.length} tabIndex={-1}
            onMouseDown={event => event.preventDefault()} onClick={() => choose()} className={`${optionClass(choices.length)} border-t border-gray-200 text-brand-blue-strong`}>
            <Plus aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">Add “{query}” as a new site</span>
          </button>}
        </div>
      </div>}
      {changing && <button type="button" onMouseDown={event => event.preventDefault()} onClick={dismiss} className="mt-1 min-h-11 text-sm text-gray-600 underline">Keep current site</button>}
      {(!open || query || value[`${endpoint}SiteCleared`]) && <p role="status" className="mt-2 text-xs text-gray-500">{open && query ? `${choices.length} matching ${choices.length === 1 ? "site" : "sites"}. Choose a result or add a new site.` : value[`${endpoint}SiteCleared`] ? "No site selected. Flight coordinates are kept." : "Your sites and public sites"}</p>}
    </div> : <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start gap-3"><MapPin aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-brand-blue-strong" /><div className="min-w-0">
        <p className="break-words font-medium text-ink">{initial.name}</p>
        <p className="text-xs text-gray-500">{isNew ? "New site · " : ""}{initial.visibility === "public" ? "Public" : "Private"} · {siteLocationLabel(initial, Boolean(flightPoint))}</p>
      </div></div>
      {isNew ? <p className="mt-2 text-xs text-gray-500">Will be created when you save this flight.</p> : staged && <p className="mt-2 text-xs text-gray-500">Site changes will be saved with this flight.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-5">
        <button type="button" onClick={() => setEditing(true)} className="min-h-11 text-left text-sm text-brand-blue-strong underline">{isNew ? "Add location or details" : "Site details"}</button>
        <button ref={changeButton} type="button" onClick={() => { focusAfterChoice.current = true; setSearch(""); setActiveIndex(-1); setChanging(true); setOpen(true); }} className="min-h-11 text-sm text-brand-blue-strong underline">Change</button>
        <button type="button" onClick={() => {
          focusAfterChoice.current = true; setSearch(""); setActiveIndex(-1); setOpen(false);
          onChange({ [`${endpoint}SiteCleared`]: "true", [`${endpoint}SiteId`]: "", [`${endpoint}SiteName`]: "", [`${endpoint}SiteDraft`]: "" });
        }} className="min-h-11 text-sm text-gray-600 underline">Clear</button>
      </div>
    </div>}
    {editing && createPortal(<SiteDialog onClose={() => setEditing(false)}><SiteEditor initial={initial} pinSource={selected?.pinSource} flightPoint={flightPoint} canChangeVisibility={selected?.canEditVisibility ?? true}
      saveLabel="Done" onCancel={() => setEditing(false)} onSave={async draft => {
        onChange({ [`${endpoint}SiteCleared`]: "", [`${endpoint}SiteDraft`]: JSON.stringify(draft), [`${endpoint}SiteId`]: draft.id ?? "", [`${endpoint}SiteName`]: draft.name }); setEditing(false);
      }} /></SiteDialog>, document.body)}
  </div>;
}
