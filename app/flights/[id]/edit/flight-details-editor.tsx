"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SuccessStatus } from "@/components/ui/success-status";
import {
  OCCUPANCIES,
  OCCUPANCY_LABELS,
  FLIGHT_TYPE_TAGS,
  FLIGHT_TYPE_TAG_LABELS,
  LAUNCH_TYPES,
  LAUNCH_TYPE_LABELS,
} from "@/lib/ratings/skill-tags";
import { updateFlightDetails, type FlightDetailsState } from "./actions";

const initial: FlightDetailsState = {};

export interface FlightDetails {
  occupancy: string | null;
  flightTypeTags: string[];
  launchTypes: string[];
  restrictedLandingField: boolean;
}

/**
 * Occupancy, Flight type, Launch type, and Landing — owner only, one
 * explicit save (notes-field idiom). Launch type and Flight type are
 * self-reported USHPA Special-Skill tags: they surface as tallies on
 * /ratings, but only an instructor's sign-off counts as verified progress.
 */
export function FlightDetailsEditor({
  flightId,
  details,
}: {
  flightId: string;
  details: FlightDetails;
}) {
  const action = updateFlightDetails.bind(null, flightId);
  const [state, formAction, pending] = useActionState(action, initial);
  const [tandemTouched, setTandemTouched] = useState(false);
  const [value, setValue] = useState(details);
  const [saved, setSaved] = useState(details);
  const submitted = useRef(details);
  useEffect(() => { if (state.ok) setSaved(submitted.current); }, [state]);
  const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((tag) => b.includes(tag));
  const dirty = (value.occupancy ?? "solo") !== (saved.occupancy ?? "solo")
    || !sameTags(value.flightTypeTags, saved.flightTypeTags)
    || !sameTags(value.launchTypes, saved.launchTypes)
    || value.restrictedLandingField !== saved.restrictedLandingField;
  const toggleTag = (field: "flightTypeTags" | "launchTypes", tag: string, checked: boolean) => {
    setValue((current) => ({ ...current, [field]: checked
      ? [...current[field], tag] : current[field].filter((item) => item !== tag) }));
  };

  return (
    <form action={formAction} onSubmit={() => { submitted.current = value; }} className="flex flex-col gap-5">
      <input type="hidden" name="tandemTouched" value={String(tandemTouched)} />
      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Occupancy
        </legend>
        <div className="flex gap-4">
          {OCCUPANCIES.map((occupancy) => (
            <label key={occupancy} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="occupancy"
                value={occupancy}
                onClick={() => setTandemTouched(true)}
                checked={(value.occupancy ?? "solo") === occupancy}
                onChange={() => { setTandemTouched(true); setValue((current) => ({ ...current, occupancy })); }}
                className="h-4 w-4 accent-brand-blue"
              />
              {OCCUPANCY_LABELS[occupancy]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Flight type
        </legend>
        <div className="flex flex-wrap gap-4">
          {FLIGHT_TYPE_TAGS.map((tag) => (
            <label key={tag} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="flightTypeTags"
                value={tag}
                checked={value.flightTypeTags.includes(tag)}
                onChange={(event) => toggleTag("flightTypeTags", tag, event.target.checked)}
                className="h-4 w-4 accent-brand-blue"
              />
              {FLIGHT_TYPE_TAG_LABELS[tag]} ({tag})
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Launch type
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {LAUNCH_TYPES.map((tag) => (
            <label key={tag} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="launchTypes"
                value={tag}
                checked={value.launchTypes.includes(tag)}
                onChange={(event) => toggleTag("launchTypes", tag, event.target.checked)}
                className="h-4 w-4 accent-brand-blue"
              />
              {LAUNCH_TYPE_LABELS[tag]} ({tag})
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Landing
        </legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="restrictedLandingField"
            checked={value.restrictedLandingField}
            onChange={(event) => setValue((current) => ({ ...current, restrictedLandingField: event.target.checked }))}
            className="h-4 w-4 accent-brand-blue"
          />
          Restricted Landing Field (RLF)
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" variant={dirty ? "primary" : "outline"} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save flight details"}
        </Button>
        {state.ok && <SuccessStatus>Saved.</SuccessStatus>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
