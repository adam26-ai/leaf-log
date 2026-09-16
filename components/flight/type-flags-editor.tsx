"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlightTypeFields } from "./type-flags";
import { Button } from "@/components/ui/button";
import type { FlightFlag } from "@/lib/flights/type-flags";
import { saveFlightFlags } from "@/app/flights/[id]/edit/actions";

export function FlightTypeEditor({ flightId, initial }: { flightId: string; initial: FlightFlag[] }) {
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const [tandemTouched, setTandemTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const initialKey = initial.join(",");
  const [previousInitial, setPreviousInitial] = useState(initialKey);
  // Other editors can change these flags. Reconcile an authoritative refresh
  // without remounting and losing this editor's save feedback. An unrelated
  // refresh with the same flags must preserve the pilot's unsaved choices.
  if (initialKey !== previousInitial) {
    setPreviousInitial(initialKey);
    setValue(initial);
    setSavedValue(initial);
    setTandemTouched(false);
  }
  const dirty = value.length !== savedValue.length || value.some((flag) => !savedValue.includes(flag));
  return <div className="space-y-4">
    <FlightTypeFields value={value} onChange={(next, changed) => { setValue(next); if (changed === "tandem") setTandemTouched(true); setMessage(""); }} disabled={pending} compactLegend />
    <div className="flex items-center gap-3"><Button type="button" variant={dirty ? "primary" : "outline"} disabled={pending || !dirty} onClick={() => startTransition(async () => {
      try {
        const result = await saveFlightFlags(flightId, value, tandemTouched);
        setMessage(result.error ?? "Saved.");
        if (!result.error) { setSavedValue(value); setTandemTouched(false); router.refresh(); }
      } catch { setMessage("Could not save flight types. Please try again."); }
    })}>{pending ? "Saving…" : "Save flight type"}</Button><span role="status" className="text-sm text-gray-600">{message}</span></div>
  </div>;
}
