"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SuccessStatus } from "@/components/ui/success-status";
import { updateInstructor, type InstructorState } from "./actions";

const initial: InstructorState = {};

export interface InstructorOption {
  id: string;
  displayName: string;
  handle: string;
  /** Currently assigned but no longer an accepted friend — shown, but
   *  resubmitting them unchanged still succeeds (see actions.ts); picking
   *  them again after a change would be rejected server-side. */
  stale?: boolean;
}

/**
 * Assign the flight's instructor of record from the owner's accepted
 * friends. Owner only, explicit save (notes-field idiom). No instructor
 * acceptance step in v1 — naming a friend here doesn't notify them.
 */
export function InstructorEditor({
  flightId,
  options,
  instructorId,
}: {
  flightId: string;
  options: InstructorOption[];
  instructorId: string | null;
}) {
  const action = updateInstructor.bind(null, flightId);
  const [state, formAction, pending] = useActionState(action, initial);
  const [value, setValue] = useState(instructorId ?? "");
  const [savedValue, setSavedValue] = useState(instructorId ?? "");
  const submittedValue = useRef(instructorId ?? "");
  useEffect(() => { if (state.ok) setSavedValue(submittedValue.current); }, [state]);

  return (
    <form action={formAction} onSubmit={() => { submittedValue.current = value; }} className="flex flex-col gap-3">
      <fieldset disabled={pending} className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="instructorId"
            value=""
            checked={value === ""}
            onChange={() => setValue("")}
            className="h-4 w-4 accent-brand-blue"
          />
          None
        </label>
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="instructorId"
              value={option.id}
              checked={value === option.id}
              onChange={() => setValue(option.id)}
              className="h-4 w-4 accent-brand-blue"
            />
            {option.displayName} (@{option.handle})
            {option.stale && (
              <span className="text-xs text-gray-400">— no longer a friend</span>
            )}
          </label>
        ))}
      </fieldset>
      {options.every((o) => o.stale) && (
        <p className="text-sm text-gray-500">
          None of your current friends are available to pick — add a friend to name them as your
          instructor.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={value === savedValue ? "outline" : "primary"} disabled={pending || value === savedValue}>
          {pending ? "Saving…" : "Save instructor"}
        </Button>
        {state.ok && <SuccessStatus>Saved.</SuccessStatus>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
