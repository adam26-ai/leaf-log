"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { WingIcon } from "@/components/icons/wing-icon";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CollapsibleSettingsCard } from "@/components/settings/collapsible-settings-card";
import type { WingSummary } from "@/lib/flights/wings";
import { Eye, EyeOff, Users } from "lucide-react";
import { saveWingNames, setWingVisibility, setWingTandem, setTandemEnabled } from "./wing-actions";

export function WingEditor({ wings, tandemEnabled = false, collapsible = false }: { wings: WingSummary[]; tandemEnabled?: boolean; collapsible?: boolean }) {
  const [selected, setSelected] = useState<(string | null)[]>([]);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [mergeTandem, setMergeTandem] = useState<boolean | null>(null);
  const router = useRouter();
  const id = useId();
  const sources = wings.filter(wing => selected.includes(wing.name));
  const name = target.trim();
  const affected = sources.filter(wing => wing.name !== name).reduce((count, wing) => count + wing.count, 0);
  const existingTarget = wings.find(wing => wing.name === name && !selected.includes(wing.name));
  const merging = sources.length > 1 || Boolean(existingTarget);
  const mergeSelection = sources.length > 1;
  const proposedTandem = mergeTandem ?? (sources.some(wing => wing.tandem) || Boolean(existingTarget?.tandem));
  const modeText = mergeSelection ? "text-emergency-orange" : "text-brand-blue-strong";

  async function save() {
    if (saving || !name || !affected) return;
    setSaving(true); setMessage(""); setError(false);
    try {
      const result = await saveWingNames({ sources, target: name, ...(tandemEnabled && merging ? { tandem: proposedTandem } : {}) });
      if (result.error) {
        setError(true); setMessage(result.error);
        if (result.stale) { setSelected([]); setTarget(""); setMergeTandem(null); router.refresh(); }
      } else {
        setMessage(`Saved “${name}” for ${result.count} ${result.count === 1 ? "flight" : "flights"}.`);
        setSelected([]); setTarget(""); setMergeTandem(null); router.refresh();
      }
    } catch { setError(true); setMessage("Couldn't save the wing names. Please try again."); }
    finally { setSaving(false); }
  }

  async function toggleVisibility(wing: WingSummary) {
    if (wing.name == null) return;
    setSaving(true); setMessage(""); setError(false);
    try {
      const result = await setWingVisibility(wing.name, !wing.hidden);
      if (result.error) { setError(true); setMessage(result.error); }
      else { setMessage(wing.hidden ? "Wing shown in flight selections." : "Wing hidden from flight selections."); router.refresh(); }
    } catch { setError(true); setMessage("Could not update wing visibility. Please try again."); }
    finally { setSaving(false); }
  }

  async function toggleTandem(wing?: WingSummary) {
    if (saving || (wing && wing.name == null)) return;
    setSaving(true); setMessage(""); setError(false);
    try {
      const result = wing ? await setWingTandem(wing.name!, !wing.tandem) : await setTandemEnabled(!tandemEnabled);
      if (result.error) { setError(true); setMessage(result.error); }
      else {
        setMergeTandem(null);
        setMessage(wing ? "Wing default saved. Manually chosen flight types are kept."
          : tandemEnabled ? "Tandem controls hidden. Saved wing defaults remain active." : "Tandem controls enabled.");
        router.refresh();
      }
    } catch { setError(true); setMessage("Could not save tandem settings. Please try again."); }
    finally { setSaving(false); }
  }

  // This card sits between the profile form's cards. Its unnamed inputs and
  // isolated events keep these bulk edits separate from profile autosaving.
  const editor = <div onChange={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!collapsible && <h2 className="flex items-center gap-2 font-condensed text-lg font-bold text-ink"><WingIcon aria-hidden="true" className="h-5 w-5" />Wings</h2>}
    </div>
    <p className="mt-1 text-sm text-gray-600">Select one wing to rename it, or several to merge them under one name.</p>
    {!wings.length ? <p className="mt-4 text-sm text-gray-500">Wings will appear here after you add flights.</p> : <fieldset disabled={saving} className="mt-4 min-w-0 space-y-4">
      <legend className="sr-only">Edit logbook wings</legend>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
        {wings.map((wing, index) => <div key={JSON.stringify(wing.name)} className={`flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2.5 last:border-0 hover:bg-gray-50 ${selected.includes(wing.name) ? mergeSelection ? "bg-emergency-orange-light" : "bg-brand-blue/5" : ""}`}>
          <input id={`${id}-wing-${index}`} type="checkbox" aria-label={`${wing.name?.trim() || "Unspecified wing"}, ${wing.count} ${wing.count === 1 ? "flight" : "flights"}`} checked={selected.includes(wing.name)} className={`h-4 w-4 shrink-0 ${mergeSelection ? "accent-emergency-orange" : "accent-brand-blue"}`} onChange={event => {
            setMessage("");
            setMergeTandem(null);
            if (event.target.checked) {
              if (!selected.length) setTarget(wing.name?.trim() ?? "");
              setSelected(previous => [...previous, wing.name]);
            } else setSelected(previous => previous.filter(value => value !== wing.name));
          }} />
          {wing.name != null && <button type="button" onClick={() => void toggleVisibility(wing)} aria-label={`${wing.hidden ? "Show" : "Hide"} ${wing.name} in flight selections`} aria-pressed={!wing.hidden} title={wing.hidden ? "Hidden from flight selections" : "Shown in flight selections"} className="grid h-7 w-7 shrink-0 place-items-center rounded text-gray-500 hover:bg-gray-200">
            {wing.hidden ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
          </button>}
          {tandemEnabled && wing.name != null && <button type="button" role="switch" aria-checked={Boolean(wing.tandem)} aria-label={`Tandem wing: ${wing.name}`} title={wing.tandem ? "Tandem wing: on" : "Tandem wing: off"} onClick={() => void toggleTandem(wing)} className={`grid h-7 w-7 shrink-0 place-items-center rounded border ${wing.tandem ? "border-brand-blue/30 bg-blue-50 text-brand-blue-strong" : "border-transparent text-gray-400 hover:bg-gray-200"}`}>
            <Users aria-hidden="true" className="h-4 w-4" />
          </button>}
          <label htmlFor={`${id}-wing-${index}`} className="min-w-0 flex-1 cursor-pointer break-words text-sm text-ink">{selected.includes(wing.name) && <span className={`font-semibold ${modeText}`}>{mergeSelection ? "Merge: " : "Rename: "}</span>}{wing.name?.trim() || "Unspecified wing"}</label>
          <span className="ml-auto text-right text-xs tabular-nums text-gray-500">{wing.count} {wing.count === 1 ? "flight" : "flights"} · {((wing.durationS ?? 0) / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 })} h</span>
        </div>)}
      </div>
      {sources.length > 0 && <div className="space-y-3">
        <label htmlFor={`${id}-name`} className={`block text-sm font-semibold ${modeText}`}>{mergeSelection ? "Merged wing name:" : "Rename wing to:"}</label>
        <input id={`${id}-name`} list={`${id}-names`} value={target} maxLength={200} onChange={event => {
          const nextExisting = wings.find(wing => wing.name === event.target.value.trim() && !selected.includes(wing.name));
          if (existingTarget?.name !== nextExisting?.name) setMergeTandem(null);
          setTarget(event.target.value); setMessage("");
        }}
          placeholder="e.g. Ozone Rush 4" className="h-10 w-full min-w-0 rounded-md border border-gray-300 bg-paper px-3 text-base text-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/40" />
        <datalist id={`${id}-names`}>{wings.filter(wing => wing.name).map(wing => <option key={wing.name!} value={wing.name!} />)}</datalist>
        {tandemEnabled && merging && <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" role="switch" checked={proposedTandem} onChange={event => setMergeTandem(event.target.checked)} className="h-4 w-4 accent-brand-blue" /><Users aria-hidden="true" className="h-4 w-4" />Merged wing is tandem</label>
          <p className="text-xs text-gray-500">Applies to future flights and existing flights using wing defaults. Manual solo or tandem choices are kept.</p>
        </div>}
        {name && affected > 0 && <div id={`${id}-warning`} className="rounded-lg border border-emergency-orange/25 bg-emergency-orange-light px-3 py-2 text-xs text-emergency-orange">
          <p><strong>Warning:</strong> Saving will change the wing name on all {affected} matching {affected === 1 ? "log entry" : "log entries"} to <strong className="break-words">{name}</strong>.</p>
          {merging && <p className="mt-1">These wings will appear as one wing in your logbook{existingTarget ? `, together with ${existingTarget.count} existing ${existingTarget.count === 1 ? "flight" : "flights"} named “${name}”` : ""}.</p>}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={!name || !affected || saving} className={mergeSelection ? "bg-emergency-orange text-white hover:bg-emergency-orange-strong" : undefined} aria-describedby={name && affected ? `${id}-warning` : undefined}>{saving ? "Saving…" : mergeSelection ? "Merge wings" : "Rename wing"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected([]); setTarget(""); setMergeTandem(null); setMessage(""); }}>Cancel</Button>
        </div>
      </div>}
    </fieldset>}
    {message && <p role={error ? "alert" : "status"} className={`mt-3 text-sm ${error ? "text-red-600" : "text-gray-600"}`}>{message}</p>}
    {tandemEnabled && <p className="mt-3 text-xs text-gray-500">Use the two-person button to set a wing’s tandem default for existing flights and future Leaf uploads. Manual solo or tandem choices are kept. Turning off Enable tandem only hides these controls.</p>}
    <div className="mt-4 space-y-2 text-xs leading-relaxed text-gray-500">
      <p>Wings in your flight logs and IGC files will show up here. To add a new wing, edit the flight details of a logbook entry, or add a new glider profile on your Leaf vario.</p>
      <p>Use the eye button in the list above to remove a wing from future flight selections. Existing flights and wing hours are kept.</p>
      <p>Future IGC uploads always default to the wing name recorded in the IGC file. Make sure your Leaf vario is set to the proper glider profile, or use Leaf Log to change a flight&apos;s glider afterward.</p>
    </div>
    <div className="mt-5 flex justify-end">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" role="switch" checked={tandemEnabled} disabled={saving} onChange={() => void toggleTandem()} className="h-4 w-4 accent-brand-blue" />Enable tandem
      </label>
    </div>
  </div>;

  if (collapsible) {
    return (
      <CollapsibleSettingsCard title="My Wings" icon={<WingIcon aria-hidden="true" className="h-8 w-8" />}>
        {editor}
      </CollapsibleSettingsCard>
    );
  }

  return <Card className="p-6">{editor}</Card>;
}
