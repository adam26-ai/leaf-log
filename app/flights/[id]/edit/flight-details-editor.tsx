"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
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

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Occupancy
        </legend>
        <div className="flex gap-4">
          {OCCUPANCIES.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="occupancy"
                value={value}
                defaultChecked={(details.occupancy ?? "solo") === value}
                className="h-4 w-4 accent-amber"
              />
              {OCCUPANCY_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
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
                defaultChecked={details.flightTypeTags.includes(tag)}
                className="h-4 w-4 accent-amber"
              />
              {FLIGHT_TYPE_TAG_LABELS[tag]} ({tag})
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
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
                defaultChecked={details.launchTypes.includes(tag)}
                className="h-4 w-4 accent-amber"
              />
              {LAUNCH_TYPE_LABELS[tag]} ({tag})
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Landing
        </legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="restrictedLandingField"
            defaultChecked={details.restrictedLandingField}
            className="h-4 w-4 accent-amber"
          />
          Restricted Landing Field (RLF)
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save flight details"}
        </Button>
        {state.ok && <span className="text-sm text-leaf-strong">Saved.</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
