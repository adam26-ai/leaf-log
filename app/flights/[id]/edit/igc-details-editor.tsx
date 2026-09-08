"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { updateIgcDetails, type NotesState } from "./actions";

export function IgcDetailsEditor({ flightId, pilot, glider, pilots, gliders }: {
  flightId: string; pilot: string; glider: string; pilots: string[]; gliders: string[];
}) {
  const [values, setValues] = useState({ pilot, glider });
  const [state, action, pending] = useActionState(updateIgcDetails.bind(null, flightId), {} as NotesState);
  const inputClass = "h-10 min-w-0 w-full rounded-md border border-gray-300 bg-paper px-3 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30";
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">Correct the pilot or glider for this flight. Choose a name from your logbook or type one below. The original IGC file stays unchanged.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["pilot", "glider"] as const).map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <label htmlFor={`igc-${field}`} className="text-sm font-medium capitalize">{field}</label>
            <select
              aria-label={`Choose a previous ${field}`}
              className={inputClass}
              value=""
              disabled={pending}
              onChange={(event) => setValues((previous) => ({ ...previous, [field]: event.target.value }))}
            >
              <option value="">Choose from your logbook…</option>
              {(field === "pilot" ? pilots : gliders).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <input id={`igc-${field}`} name={field} className={inputClass} value={values[field]}
              maxLength={200} disabled={pending} placeholder={`Enter ${field} name`}
              onChange={(event) => setValues((previous) => ({ ...previous, [field]: event.target.value }))} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save pilot and glider"}</Button>
        <span role="status" className={state.error ? "text-sm text-red-600" : "text-sm text-brand-blue-strong"}>
          {state.error ?? (state.ok ? "Saved." : "")}
        </span>
      </div>
    </form>
  );
}
