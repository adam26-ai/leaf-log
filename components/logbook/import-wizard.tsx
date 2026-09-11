"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, FileSpreadsheet, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuccessMark } from "@/components/ui/success-status";
import { Card } from "@/components/ui/card";
import { ENTRY_FIELDS, parseEntry, type EntryDraft, type EntryField } from "@/lib/logbook/entry";
import { CSV_DEFAULTS, MAX_CSV_BYTES, csvEntries, guessColumns, parseCsv, type ColumnMapping, type CsvOptions, type CsvTable, type ImportRow } from "@/lib/logbook/csv";
import type { EntryOptions } from "@/lib/logbook/options";
import { suggestNames } from "@/lib/logbook/names";
import { EntryFields, entryInputClass } from "./entry-fields";
import { useHydrated } from "@/lib/use-hydrated";
import { XC_TYPE_LABELS } from "@/lib/flights/recording";

type Review = { line: number; errors: string[]; warnings: string[]; duplicates: { id: string; label: string }[] };
type Match = { name: string; siteId: string };
type NameField = "glider" | "takeoffSiteName" | "landingSiteName";
const steps = ["Choose CSV", "Match columns", "Tidy names", "Review flights"];

export function ImportWizard({ options }: { options: EntryOptions }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const requestId = useRef<string>("");
  const [step, setStep] = useState(0);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [formats, setFormats] = useState<CsvOptions>(CSV_DEFAULTS);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [review, setReview] = useState<Review[] | null>(null);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [visibility, setVisibility] = useState("private");
  const [result, setResult] = useState<{ importedCount: number; skippedCount: number; alreadyImported: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function openFile(file: File | undefined) {
    if (!file) return;
    setError(""); setPending(true);
    try {
      if (file.size > MAX_CSV_BYTES) throw new Error("Choose a CSV of 2 MB or less.");
      const text = await file.text(), parsed = parseCsv(text);
      setCsv(text); setFilename(file.name); setTable(parsed); setMapping(guessColumns(parsed.headers));
      setFormats(CSV_DEFAULTS); setRows([]); setReview(null); setMatches({}); setPage(0); setEditing(null); setResult(null); setConfirm(false);
      requestId.current = crypto.randomUUID(); setStep(1);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open this file."); }
    finally { setPending(false); }
  }
  function prepareNames() {
    if (!table || mapping.date === undefined) { setError("Match a column to Flight date."); return; }
    const assigned = Object.values(mapping).filter(index => index !== undefined);
    if (new Set(assigned).size !== assigned.length) { setError("Use each CSV column only once."); return; }
    setRows(csvEntries(table, mapping, formats)); setMatches({}); setReview(null); setConfirm(false); setError(""); setStep(2);
  }
  function applyNames() {
    const updated = rows.map(row => {
      const draft = { ...row.draft };
      for (const field of ["glider", "takeoffSiteName", "landingSiteName"] as const) {
        const match = matches[`${field}:${draft[field]}`];
        if (!match) continue;
        draft[field] = match.name;
        if (field !== "glider") {
          const endpoint = field === "takeoffSiteName" ? "takeoff" : "landing";
          const site = options.sites.find(site => site.id === match.siteId);
          draft[`${endpoint}SiteId`] = site?.id ?? "";
          if (site) { draft[field] = site.name; draft[`${endpoint}Lat`] = String(site.lat); draft[`${endpoint}Lon`] = String(site.lon); }
        }
      }
      return { ...row, draft, allowDuplicate: false };
    });
    setRows(updated); setReview(null); setPage(0); setEditing(null); setStep(3); void check(updated);
  }
  const payload = (items: ImportRow[]) => ({ requestId: requestId.current, csv, filename, visibility, rows: items });
  async function check(items = rows) {
    setPending(true); setError(""); setConfirm(false);
    try {
      const response = await fetch("/api/logbook/imports?preview=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(items)) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not review these flights.");
      setReview(result.rows);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not review. Please retry."); }
    finally { setPending(false); }
  }
  function updateRow(index: number, patch: Partial<ImportRow>) {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setConfirm(false);
    if (patch.draft || patch.excluded !== undefined) setReview(null);
  }
  async function commit() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/logbook/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(rows)) });
      const result = await response.json();
      if (!response.ok) { setConfirm(false); setReview(null); throw new Error(result.error ?? "Could not import these flights."); }
      setResult(result); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not import. Retry to check whether it completed."); }
    finally { setPending(false); }
  }
  const included = rows.filter(row => !row.excluded);
  const blocking = review ? rows.filter((row, i) => !row.excluded && (review[i].errors.length > 0 || (review[i].duplicates.length > 0 && !row.allowDuplicate))).length : 0;
  const totalMinutes = included.reduce((total, row) => total + (Number(row.draft.durationMinutes) || 0), 0);
  const unknownDurations = included.filter(row => !row.draft.durationMinutes).length;
  const editRow = editing === null ? null : rows[editing];
  const editParsed = editRow ? parseEntry(editRow.draft) : null;

  function nameGroup(field: NameField, title: string) {
    const counts = new Map<string, number>();
    rows.forEach(row => counts.set(row.draft[field], (counts.get(row.draft[field]) ?? 0) + 1));
    const candidates = field === "glider" ? [...options.wings, ...counts.keys()] : [...options.siteNames, ...options.sites.map(site => site.name), ...counts.keys()];
    return <details open={counts.size <= 15} className="rounded-lg border border-gray-200 p-4"><summary className="cursor-pointer font-medium">{title} <span className="text-sm font-normal text-gray-500">({counts.size} {counts.size === 1 ? "name" : "names"})</span></summary>
      <datalist id={`names-${field}`}>{[...new Set(candidates)].filter(Boolean).map(name => <option key={name} value={name} />)}</datalist>
      <div className="mt-4 flex flex-col gap-4">{[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => {
        const key = `${field}:${name}`, match = matches[key] ?? { name, siteId: "" };
        const suggestions = suggestNames(name, candidates);
        const setMatch = (next: Match) => setMatches(current => ({ ...current, [key]: next }));
        return <div key={key} className="grid gap-2 border-t border-gray-100 pt-3 first:border-0 first:pt-0 sm:grid-cols-[1fr_2fr]">
          <div className="min-w-0 text-sm"><p className="break-words font-medium">{name || "Missing name"}</p><p className="text-xs text-gray-500">{count} {count === 1 ? "flight" : "flights"}</p></div>
          <div className="flex min-w-0 flex-col gap-2">
            <input aria-label={`${title}: ${name || "missing name"}`} list={`names-${field}`} value={match.name} onChange={e => setMatch({ name: e.target.value, siteId: "" })} placeholder="Leave unknown, or fill in a name" className={entryInputClass} />
            {field !== "glider" && <select aria-label={`Map location for ${title.toLowerCase()}: ${name || "missing name"}`} value={match.siteId} onChange={e => { const site = options.sites.find(site => site.id === e.target.value); setMatch({ name: site?.name ?? match.name, siteId: site?.id ?? "" }); }} className={entryInputClass}>
              <option value="">Keep coordinates from CSV, or choose a known site…</option>
              {options.sites.map(site => <option key={site.id} value={site.id}>{site.previous ? "★ " : ""}{site.name} ({site.lat.toFixed(2)}, {site.lon.toFixed(2)})</option>)}
            </select>}
            {suggestions.length > 0 && <p className="flex flex-wrap gap-x-2 text-xs text-gray-500">Similar:{suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => setMatch({ name: suggestion, siteId: "" })} className="text-brand-blue-strong underline">{suggestion}</button>)}</p>}
          </div>
        </div>;
      })}</div>
    </details>;
  }
  if (result) return <Card className="flex flex-col gap-4 p-6" aria-live="polite">
    <SuccessMark size="lg" /><h2 className="font-condensed text-2xl font-bold">{result.alreadyImported ? "This file was already imported" : "Your flights are in your logbook"}</h2>
    <p className="text-sm text-gray-600">{result.importedCount} {result.importedCount === 1 ? "flight" : "flights"} imported · {result.skippedCount} skipped.{result.alreadyImported && " No extra copies were added."}</p>
    <div className="flex flex-wrap gap-3"><Button asChild><Link href="/logbook">Open logbook</Link></Button><Button variant="outline" onClick={() => { setStep(0); setResult(null); }}>Import another CSV</Button></div>
  </Card>;
  return <div className="flex flex-col gap-5">
    <ol aria-label="Import steps" className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`rounded-md border px-3 py-2 ${step === index ? "border-brand-blue bg-brand-blue/5 text-ink" : "border-gray-200 text-gray-500"}`}>{index + 1}. {label}</li>)}</ol>
    {step === 0 && <Card className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-3"><FileSpreadsheet className="h-7 w-7 text-brand-blue" /><h2 className="font-condensed text-xl font-bold">Bring your earlier flights along</h2></div>
      <p className="text-sm text-gray-600">Use one row per flight. Only the date is required; leave unknown details blank. These flights count toward your totals and personal bests, with reported measurements identified.</p>
      <div className="flex flex-wrap gap-4 text-sm"><a href="/api/logbook/template" download className="inline-flex items-center gap-1.5 text-brand-blue-strong underline"><Download className="h-4 w-4" />Download CSV template</a><a href="/api/logbook/template?example=1" download className="text-brand-blue-strong underline">Download an example</a></div>
      <p className="text-xs text-gray-500">Template dates: YYYY-MM-DD. Duration: minutes. Use altitude_unit (m / ft), distance_unit (km / mi / nmi), and xc_type (open / fai-triangle / free-triangle). Altitudes are above sea level. Existing CSV headings can be matched in the next step.</p>
      <label className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center text-sm"><span className="mb-3 block font-medium">Choose your completed CSV</span><input aria-label="Choose logbook CSV" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={pending || !hydrated} onChange={e => void openFile(e.target.files?.[0])} className="max-w-full text-xs" /><span className="mt-3 block text-xs text-gray-500">Up to 5,000 flights / 2 MB. Nothing is saved until you confirm the review.</span></label>
    </Card>}
    {step === 1 && table && <Card className="flex flex-col gap-5 p-5">
      <div><h2 className="font-condensed text-xl font-bold">Match your columns</h2><p className="mt-1 break-all text-sm text-gray-500">{filename} · {table.rows.length} {table.rows.length === 1 ? "flight" : "flights"}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Date format<select value={formats.dateFormat} onChange={e => setFormats({ ...formats, dateFormat: e.target.value as CsvOptions["dateFormat"] })} className={entryInputClass}><option value="ymd">Year-month-day (2020-06-15)</option><option value="mdy">Month/day/year (06/15/2020)</option><option value="dmy">Day/month/year (15/06/2020)</option></select></label>
        <label className="text-sm">Duration format<select value={formats.durationFormat} onChange={e => setFormats({ ...formats, durationFormat: e.target.value as CsvOptions["durationFormat"] })} className={entryInputClass}><option value="minutes">Minutes (95)</option><option value="hours">Decimal hours (1.5)</option><option value="clock">Hours:minutes[:seconds] (1:35)</option><option value="seconds">Seconds (5700)</option></select></label>
        <label className="text-sm">Default altitude unit<select value={formats.altitudeUnit} onChange={e => setFormats({ ...formats, altitudeUnit: e.target.value as CsvOptions["altitudeUnit"] })} className={entryInputClass}><option value="m">Meters</option><option value="ft">Feet</option></select></label>
        <label className="text-sm">Default distance unit<select value={formats.distanceUnit} onChange={e => setFormats({ ...formats, distanceUnit: e.target.value as CsvOptions["distanceUnit"] })} className={entryInputClass}><option value="km">km</option><option value="mi">Miles</option><option value="nmi">Nautical miles</option></select></label>
        <label className="text-sm">Default vertical speed unit<select value={formats.varioUnit} onChange={e => setFormats({ ...formats, varioUnit: e.target.value as CsvOptions["varioUnit"] })} className={entryInputClass}><option value="m/s">m/s</option><option value="ft/min">ft/min</option><option value="knots">Knots</option></select></label>
        <label className="text-sm">Default time zone (if times are provided)<input value={formats.timeZone} onChange={e => setFormats({ ...formats, timeZone: e.target.value })} placeholder="America/Los_Angeles or -07:00" className={entryInputClass} /></label>
      </div>
      <p className="text-xs text-gray-500">Unit and time zone columns override these defaults for each flight. Check date formats carefully; 04/05 could mean April 5 or May 4.</p>
      <div className="grid gap-3 sm:grid-cols-2">{(Object.keys(ENTRY_FIELDS) as EntryField[]).map(field => <label key={field} className="min-w-0 text-sm">{ENTRY_FIELDS[field]}{field === "date" && " *"}<select value={mapping[field] ?? ""} onChange={e => setMapping({ ...mapping, [field]: e.target.value === "" ? undefined : Number(e.target.value) })} className={entryInputClass}>
        <option value="">Not provided</option>{table.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select><span className="mt-1 block truncate text-xs text-gray-400">{mapping[field] !== undefined ? `Example: ${table.rows[0].cells[mapping[field]!] || "(blank)"}` : "\u00a0"}</span></label>)}</div>
      <div className="flex gap-3"><Button variant="outline" onClick={() => setStep(0)}>Choose another file</Button><Button onClick={prepareNames}>Continue to names</Button></div>
    </Card>}
    {step === 2 && <Card className="flex flex-col gap-5 p-5"><h2 className="font-condensed text-xl font-bold">Give matching names a common spelling</h2><p className="text-sm text-gray-600">Changes here apply to all listed flights with that name. Suggestions need your choice. Choose a known site to add its map location; names alone are not used to guess coordinates. Your existing logbook and the shared site directory are unchanged.</p>
      {nameGroup("glider", "Wings")}{nameGroup("takeoffSiteName", "Flying sites")}{nameGroup("landingSiteName", "Landing sites")}
      <div className="flex gap-3"><Button variant="outline" onClick={() => setStep(1)}>Back to columns</Button><Button onClick={applyNames}>Review flights</Button></div>
    </Card>}
    {step === 3 && <Card className="flex flex-col gap-5 p-5">
      <h2 className="font-condensed text-xl font-bold">Review your flights</h2>
      <p className="text-sm text-gray-600">Edit a flight to fill in details or place its site on the map. Missing optional values are okay. Skip unwanted rows; possible duplicates need an explicit choice.</p>
      {editRow && editing !== null ? <div className="flex flex-col gap-4 rounded-lg border border-brand-blue/40 p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">CSV line {editRow.line}</h3><Button variant="outline" onClick={() => setEditing(null)}><ArrowLeft className="h-4 w-4" />Back to review</Button></div><EntryFields value={editRow.draft} onChange={(draft: EntryDraft) => updateRow(editing, { draft, allowDuplicate: false })} options={options} issues={editParsed && !editParsed.ok ? editParsed.issues : []} expanded /></div> : <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{included.length} selected · {rows.length - included.length} skipped</span><button disabled={pending} onClick={() => { const duplicateLines = new Set(review?.filter(item => item.duplicates.length).map(item => item.line)); setRows(rows.map(row => duplicateLines.has(row.line) ? { ...row, excluded: true } : row)); setReview(null); setConfirm(false); }} className="text-brand-blue-strong underline disabled:opacity-50" hidden={!review?.some(item => item.duplicates.length)}>Skip all possible duplicates</button></div>
        <div className="flex flex-col gap-2">{rows.slice(page * 25, page * 25 + 25).map((row, localIndex) => {
          const index = page * 25 + localIndex, detail = review?.[index];
          return <div key={row.line} className={`rounded-lg border p-3 ${row.excluded ? "border-gray-200 bg-gray-50" : detail?.errors.length ? "border-red-300" : "border-gray-200"}`}>
            <div className="flex items-start gap-3"><input type="checkbox" aria-label={`Include CSV line ${row.line}`} checked={!row.excluded} disabled={pending} onChange={e => updateRow(index, { excluded: !e.target.checked })} className="mt-1" /><div className="min-w-0 flex-1 text-sm"><p className="font-medium">{row.draft.date || "Date missing"} <span className="font-normal text-gray-500">· line {row.line}</span></p><p className="break-words text-gray-600">{row.draft.takeoffSiteName || "Unknown site"} · {row.draft.glider || "Unknown wing"}</p><p className="text-xs text-gray-500">{row.draft.durationMinutes ? `${row.draft.durationMinutes} min` : "Duration unknown"}{row.draft.xcDistance ? ` · ${row.draft.xcDistance} ${row.draft.distanceUnit} ${XC_TYPE_LABELS[row.draft.xcType as keyof typeof XC_TYPE_LABELS] ?? row.draft.xcType} (reported)` : ""}</p></div><button disabled={pending} onClick={() => setEditing(index)} className="text-sm text-brand-blue-strong underline">Edit</button></div>
            {!row.excluded && detail && <div className="mt-2 pl-6 text-xs">{detail.errors.map(message => <p key={message} className="text-red-600">{message}</p>)}{detail.warnings.map(message => <p key={message} className="text-gray-500">{message}</p>)}{detail.duplicates.length > 0 && <div className="mt-2 rounded border border-emergency-orange/25 bg-emergency-orange-light p-2 text-emergency-orange"><p className="font-medium">Possible duplicate of:</p>{detail.duplicates.map(match => <p key={match.id}>{match.id.startsWith("row:") ? match.label : <Link href={`/flights/${match.id}`} target="_blank" className="underline">{match.label}</Link>}</p>)}<label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={row.allowDuplicate} disabled={pending} onChange={e => updateRow(index, { allowDuplicate: e.target.checked })} />This is a different flight; include it</label></div>}</div>}
          </div>;
        })}</div>
        {rows.length > 25 && <div className="flex items-center justify-between gap-3 text-sm"><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page + 1} of {Math.ceil(rows.length / 25)}</span><Button variant="outline" disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(page + 1)}>Next</Button></div>}
      </>}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={pending} onClick={() => { setStep(2); setMatches({}); setReview(null); setConfirm(false); }}>Back to names</Button><Button disabled={pending} onClick={() => { setEditing(null); void check(); }}>{pending ? "Checking…" : "Check preview"}</Button><span className="text-sm text-gray-500" role="status">{review ? blocking ? `${blocking} ${blocking === 1 ? "flight needs" : "flights need"} a correction or duplicate choice.` : "Preview checked." : "Check the preview after making changes."}</span></div>
      {review && !blocking && included.length > 0 && editing === null && <div className="flex flex-col gap-4 border-t border-gray-200 pt-5">
        <p className="text-sm"><strong>{included.length} {included.length === 1 ? "flight" : "flights"}</strong> · {(totalMinutes / 60).toFixed(1)} {(totalMinutes / 60).toFixed(1) === "1.0" ? "hour" : "hours"}{unknownDurations > 0 && ` + ${unknownDurations} ${unknownDurations === 1 ? "flight" : "flights"} with unknown duration`} · {rows.length - included.length} skipped</p>
        <label className="max-w-xs text-sm">Visibility for these flights<select value={visibility} disabled={pending} onChange={e => { setVisibility(e.target.value); setConfirm(false); }} className={entryInputClass}><option value="private">Private</option><option value="friends">Friends only</option><option value="public">Public</option></select></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} disabled={pending} onChange={e => setConfirm(e.target.checked)} className="mt-1" />I have checked the dates, units, and selected flights.</label>
        <Button className="self-start" disabled={!confirm || pending} onClick={() => void commit()}>{pending ? "Importing…" : `Import ${included.length} ${included.length === 1 ? "flight" : "flights"}`}</Button>
      </div>}
    </Card>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </div>;
}
