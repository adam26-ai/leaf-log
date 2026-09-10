"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { SuccessStatus } from "@/components/ui/success-status";
import { updateFlightWing, type NotesState } from "./actions";
import { useHydrated } from "@/lib/use-hydrated";

export function FlightWingEditor({ flightId, glider, gliders }: {
  flightId: string; glider: string; gliders: string[];
}) {
  const [value, setValue] = useState(glider);
  const [state, action, pending] = useActionState(updateFlightWing.bind(null, flightId), {} as NotesState);
  const hydrated = useHydrated();
  const inputClass = "h-10 min-w-0 w-full rounded-md border border-gray-300 bg-paper px-3 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30";
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">Choose a wing from your logbook or enter its name. The original IGC file stays unchanged.</p>
      <fieldset disabled={pending || !hydrated} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="previous-wing" className="text-sm font-medium">Previous wings</label>
            <select
              id="previous-wing"
              aria-label="Choose a previous wing"
              className={inputClass}
              value=""
              onChange={(event) => setValue(event.target.value)}
            >
              <option value="">Choose from your logbook…</option>
              {gliders.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="flight-wing" className="text-sm font-medium">Wing name</label>
            <input id="flight-wing" name="glider" className={inputClass} value={value}
              maxLength={200} placeholder="Enter wing name" onChange={(event) => setValue(event.target.value)} />
          </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !hydrated}>{pending ? "Saving…" : "Save wing"}</Button>
        {state.error && <span role="status" className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <SuccessStatus>Saved.</SuccessStatus>}
      </div>
    </form>
  );
}
