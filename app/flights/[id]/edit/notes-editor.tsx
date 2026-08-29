"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { updateNotes, type NotesState } from "./actions";

const initial: NotesState = {};

/** Free-text notes about the flight — owner only, explicit save (unlike
 *  visibility, this isn't a click-to-apply toggle). */
export function NotesEditor({ flightId, notes }: { flightId: string; notes: string }) {
  const action = updateNotes.bind(null, flightId);
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <textarea
        name="notes"
        defaultValue={notes}
        maxLength={2000}
        rows={5}
        placeholder="Conditions, line choices, what you'd do differently — anything worth remembering next time you fly here."
        className="resize-none rounded-md border border-gray-300 bg-paper px-3 py-2 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save notes"}
        </Button>
        {state.ok && <span className="text-sm text-leaf-strong">Saved.</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
