"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { emptyEntry, parseEntry, type EntryDraft, type EntryIssue } from "@/lib/logbook/entry";
import type { EntryOptions } from "@/lib/logbook/options";
import { EntryFields, entryInputClass } from "./entry-fields";
import { useHydrated } from "@/lib/use-hydrated";

export function ManualEntryForm({ options, initial, flightId, expectedUpdatedAt, defaultVisibility = "private", imperial = false }: {
  options: EntryOptions; initial?: EntryDraft; flightId?: string; expectedUpdatedAt?: string; defaultVisibility?: string; imperial?: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const requestId = useRef<string | null>(null);
  const [draft, setDraft] = useState(() => initial ?? emptyEntry(imperial));
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [issues, setIssues] = useState<EntryIssue[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; date: string; site: string | null; wing: string | null }[]>([]);
  async function save(allowDuplicate = false) {
    const parsed = parseEntry(draft);
    if (!parsed.ok) { setIssues(parsed.issues); setError("Check the highlighted fields before saving."); return; }
    setIssues([]); setError(""); setPending(true);
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/logbook/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft, visibility, requestId: requestId.current, flightId, expectedUpdatedAt, allowDuplicate }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save this flight.");
      if (result.duplicates) { setDuplicates(result.duplicates); return; }
      router.push(`/flights/${result.id}`); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save. Please retry."); }
    finally { setPending(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }} className="flex flex-col gap-5">
    <fieldset disabled={pending || !hydrated} className="min-w-0"><EntryFields value={draft} onChange={value => { setDraft(value); setDuplicates([]); }} options={options} issues={issues} expanded={Boolean(flightId)} /></fieldset>
    <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium text-gray-700">Visibility
      <select value={visibility} onChange={event => setVisibility(event.target.value)} disabled={pending} className={entryInputClass}>
        <option value="private">Private</option><option value="friends">Friends only</option><option value="public">Public</option>
      </select>
    </label>
    {duplicates.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium">This may already be in your logbook</p>
      <ul className="my-2 list-disc pl-5">{duplicates.map(item => <li key={item.id}><Link href={`/flights/${item.id}`} target="_blank" className="underline">{item.date} · {item.site ?? "Unknown site"} · {item.wing ?? "Unknown wing"}</Link></li>)}</ul>
      <button type="button" disabled={pending} onClick={() => void save(true)} className="font-medium underline">These are different flights — add a separate entry</button>
    </div>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : flightId ? "Save flight details" : "Add manual flight"}</Button>
    {!flightId && <p className="text-xs text-gray-500">Only the date is required. Leave measurements you don’t know blank.</p>}
  </form>;
}
