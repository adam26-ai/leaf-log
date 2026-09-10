"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/flights/format";
import { useHydrated } from "@/lib/use-hydrated";

type Facts = { date: string; durationS: number | null; maxAltM: number | null; launchAltM: number | null; altGainM: number | null; maxClimbMs: number | null; maxSinkMs: number | null; takeoffAt: string | null; landingAt: string | null; takeoffLat: number | null; takeoffLon: number | null; landingLat: number | null; landingLon: number | null };
type Preview = { hash: string; expectedUpdatedAt: string; warnings: string[]; previous: Facts; recorded: Facts };
const display = (field: keyof Facts, value: Facts[keyof Facts]) => value == null ? "Unknown" : field === "durationS" ? formatDuration(Number(value)) : ["maxAltM", "launchAltM", "altGainM"].includes(field) ? `${value} m` : ["maxClimbMs", "maxSinkMs"].includes(field) ? `${Number(value).toFixed(1)} m/s` : field.endsWith("At") ? String(value).replace("T", " ").replace(".000Z", " UTC") : String(value);
const labels: Partial<Record<keyof Facts, string>> = { date: "Flight date", durationS: "Duration", maxAltM: "Maximum altitude", launchAltM: "Launch altitude", altGainM: "Total climbs", maxClimbMs: "Best climb", maxSinkMs: "Max sink", takeoffAt: "Takeoff", landingAt: "Landing" };
export function AttachIgcForm({ flightId }: { flightId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(commit: boolean) {
    if (!file) return;
    setPending(true); setError("");
    try {
      const body = new FormData(); body.set("file", file); body.set("operation", commit ? "commit" : "preview");
      if (preview) { body.set("hash", preview.hash); body.set("expectedUpdatedAt", preview.expectedUpdatedAt); }
      const response = await fetch(`/api/flights/${flightId}/attach-igc`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setPreview(null); throw new Error(result.error ?? "Could not attach this recording."); }
      if (result.attached) { router.push(`/flights/${flightId}`); router.refresh(); } else setPreview(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not attach this recording."); }
    finally { setPending(false); }
  }
  return <div className="flex flex-col gap-4 text-sm"><p className="text-gray-600">Found the recording? Add it to this flight to enable replay. Review the measured details before replacing the entered values.</p>
    <input aria-label="IGC to attach" type="file" accept=".igc" disabled={pending || !hydrated} className="max-w-full text-xs" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(""); }} />
    {!preview && <Button className="self-start" variant="outline" disabled={!file || pending} onClick={() => void submit(false)}>{pending ? "Reading…" : "Compare IGC with this entry"}</Button>}
    {preview && <><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-gray-200"><th className="p-2">Detail</th><th className="p-2">Entered</th><th className="p-2">From IGC</th></tr></thead><tbody>{Object.entries(labels).map(([field, label]) => <tr key={field} className="border-b border-gray-100"><th className="p-2 font-medium">{label}</th><td className="p-2">{display(field as keyof Facts, preview.previous[field as keyof Facts])}</td><td className="p-2">{display(field as keyof Facts, preview.recorded[field as keyof Facts])}</td></tr>)}{(["takeoff", "landing"] as const).map(endpoint => <tr key={endpoint}><th className="p-2 font-medium">{endpoint === "takeoff" ? "Takeoff" : "Landing"} coordinates</th>{([preview.previous, preview.recorded]).map((facts, index) => <td key={index} className="p-2">{facts[`${endpoint}Lat`] == null || facts[`${endpoint}Lon`] == null ? "Unknown" : `${facts[`${endpoint}Lat`]!.toFixed(5)}, ${facts[`${endpoint}Lon`]!.toFixed(5)}`}</td>)}</tr>)}</tbody></table></div>
      <p className="text-gray-600">Attaching replaces these measurements and adds the recorded track to this same flight. Your wing, chosen site names, notes, photos, visibility, and reported XC result are kept. Blank wings and sites may be filled from the recording. XC calculation runs separately.</p>
      {preview.previous.date !== preview.recorded.date && <p className="rounded border border-emergency-orange/25 bg-emergency-orange-light p-3 text-emergency-orange">The recording is from a different date. Make sure it belongs to this flight.</p>}
      {preview.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-gray-500">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <Button className="self-start" disabled={pending} onClick={() => void submit(true)}>{pending ? "Attaching…" : "Attach IGC and use recorded measurements"}</Button>
    </>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
