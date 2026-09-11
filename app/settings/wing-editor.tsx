"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { WingIcon } from "@/components/icons/wing-icon";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WingSummary } from "@/lib/flights/wings";
import { saveWingNames } from "./wing-actions";

export function WingEditor({ wings }: { wings: WingSummary[] }) {
  const [selected, setSelected] = useState<(string | null)[]>([]);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();
  const id = useId();
  const sources = wings.filter(wing => selected.includes(wing.name));
  const name = target.trim();
  const affected = sources.filter(wing => wing.name !== name).reduce((count, wing) => count + wing.count, 0);
  const existingTarget = wings.find(wing => wing.name === name && !selected.includes(wing.name));
  const merging = sources.length > 1 || Boolean(existingTarget);
  const mergeSelection = sources.length > 1;
  const modeText = mergeSelection ? "text-emergency-orange" : "text-brand-blue-strong";

  async function save() {
    if (saving || !name || !affected) return;
    setSaving(true); setMessage(""); setError(false);
    try {
      const result = await saveWingNames({ sources, target: name });
      if (result.error) {
        setError(true); setMessage(result.error);
        if (result.stale) { setSelected([]); setTarget(""); router.refresh(); }
      } else {
        setMessage(`Saved “${name}” for ${result.count} ${result.count === 1 ? "flight" : "flights"}.`);
        setSelected([]); setTarget(""); router.refresh();
      }
    } catch { setError(true); setMessage("Couldn't save the wing names. Please try again."); }
    finally { setSaving(false); }
  }

  // This card sits between the profile form's cards. Its unnamed inputs and
  // isolated events keep these bulk edits separate from profile autosaving.
  return <Card className="p-6" onChange={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <h2 className="flex items-center gap-2 font-condensed text-lg font-bold text-ink"><WingIcon aria-hidden="true" className="h-5 w-5" />Wings</h2>
    <p className="mt-1 text-sm text-gray-600">Select one wing to rename it, or several to merge them under one name.</p>
    {!wings.length ? <p className="mt-4 text-sm text-gray-500">Wings will appear here after you add flights.</p> : <fieldset disabled={saving} className="mt-4 min-w-0 space-y-4">
      <legend className="sr-only">Edit logbook wings</legend>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
        {wings.map(wing => <label key={JSON.stringify(wing.name)} className={`flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-0 hover:bg-gray-50 ${mergeSelection ? "has-[:checked]:bg-emergency-orange-light" : "has-[:checked]:bg-brand-blue/5"}`}>
          <input type="checkbox" aria-label={`${wing.name?.trim() || "Unspecified wing"}, ${wing.count} ${wing.count === 1 ? "flight" : "flights"}`} checked={selected.includes(wing.name)} className={`h-4 w-4 shrink-0 ${mergeSelection ? "accent-emergency-orange" : "accent-brand-blue"}`} onChange={event => {
            setMessage("");
            if (event.target.checked) {
              if (!selected.length) setTarget(wing.name?.trim() ?? "");
              setSelected(previous => [...previous, wing.name]);
            } else setSelected(previous => previous.filter(value => value !== wing.name));
          }} />
          <span className="min-w-0 flex-1 break-words text-sm text-ink">{selected.includes(wing.name) && <span className={`font-semibold ${modeText}`}>{mergeSelection ? "Merge: " : "Rename: "}</span>}{wing.name?.trim() || "Unspecified wing"}</span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500">{wing.count} {wing.count === 1 ? "flight" : "flights"}</span>
        </label>)}
      </div>
      {sources.length > 0 && <div className="space-y-3">
        <label htmlFor={`${id}-name`} className={`block text-sm font-semibold ${modeText}`}>{mergeSelection ? "Merged wing name:" : "Rename wing to:"}</label>
        <input id={`${id}-name`} list={`${id}-names`} value={target} maxLength={200} onChange={event => { setTarget(event.target.value); setMessage(""); }}
          placeholder="e.g. Ozone Rush 4" className="h-10 w-full min-w-0 rounded-md border border-gray-300 bg-paper px-3 text-base text-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/40" />
        <datalist id={`${id}-names`}>{wings.filter(wing => wing.name).map(wing => <option key={wing.name!} value={wing.name!} />)}</datalist>
        {name && affected > 0 && <div id={`${id}-warning`} className="rounded-lg border border-emergency-orange/25 bg-emergency-orange-light px-3 py-2 text-xs text-emergency-orange">
          <p><strong>Warning:</strong> Saving will change the wing name on all {affected} matching {affected === 1 ? "log entry" : "log entries"} to <strong className="break-words">{name}</strong>.</p>
          {merging && <p className="mt-1">These wings will appear as one wing in your logbook{existingTarget ? `, together with ${existingTarget.count} existing ${existingTarget.count === 1 ? "flight" : "flights"} named “${name}”` : ""}.</p>}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={!name || !affected || saving} className={mergeSelection ? "bg-emergency-orange text-white hover:bg-emergency-orange-strong" : undefined} aria-describedby={name && affected ? `${id}-warning` : undefined}>{saving ? "Saving…" : mergeSelection ? "Merge wings" : "Rename wing"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected([]); setTarget(""); setMessage(""); }}>Cancel</Button>
        </div>
      </div>}
    </fieldset>}
    {message && <p role={error ? "alert" : "status"} className={`mt-3 text-sm ${error ? "text-red-600" : "text-gray-600"}`}>{message}</p>}
    {wings.length > 0 && <p className="mt-3 text-xs text-gray-500">Applies to existing flights. Future uploads use the wing name recorded in their file.</p>}
  </Card>;
}
