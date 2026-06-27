"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  FLIGHT_VISIBILITIES,
  normalizeVisibility,
  type FlightVisibility,
} from "@/lib/flights/visibility";
import { updateProfile, type SettingsState } from "./actions";

const initial: SettingsState = {};

const VISIBILITY_COPY: Record<FlightVisibility, { label: string; hint: string }> = {
  private: {
    label: "Private",
    hint: "Only you can see new flights until you share them.",
  },
  friends: {
    label: "Friends only",
    hint: "Visible to pilots you're friends with.",
  },
  public: {
    label: "Public",
    hint: "New flights are visible to anyone with the link.",
  },
};

/** Edit handle, display name, bio, and the default privacy for new flights. */
export function SettingsForm({
  handle,
  displayName,
  bio,
  defaultVisibility,
}: {
  handle: string;
  displayName: string;
  bio: string;
  defaultVisibility: string;
}) {
  const [state, formAction, pending] = useActionState(updateProfile, initial);
  const normalizedDefaultVisibility = normalizeVisibility(defaultVisibility);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Handle
        </span>
        <div className="flex items-center rounded-md border border-gray-300 bg-paper focus-within:border-amber focus-within:ring-2 focus-within:ring-amber/40">
          <span className="pl-3 font-mono text-gray-500">@</span>
          <input
            name="handle"
            required
            defaultValue={handle}
            pattern="[A-Za-z0-9_]{3,20}"
            className="h-11 w-full bg-transparent px-2 font-mono text-ink outline-none"
          />
        </div>
        <span className="text-xs text-gray-500">
          Your public profile lives at /@{handle}. Changing this changes that link.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Display name
        </span>
        <input
          name="display_name"
          required
          defaultValue={displayName}
          maxLength={60}
          className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Bio
        </span>
        <textarea
          name="bio"
          defaultValue={bio}
          maxLength={280}
          rows={3}
          placeholder="A line about your flying — wings, home site, anything."
          className="resize-none rounded-md border border-gray-300 bg-paper px-3 py-2 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-condensed text-sm font-bold tracking-wide text-ink">
          Default privacy for new flights
        </legend>
        <span className="text-xs text-gray-500">
          New uploads start at this visibility. You can change any flight later.
        </span>
        <div className="mt-1 flex flex-col gap-2">
          {FLIGHT_VISIBILITIES.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-paper px-3 py-2.5 hover:border-amber has-[:checked]:border-amber has-[:checked]:bg-amber/5"
            >
              <input
                type="radio"
                name="default_visibility"
                value={value}
                defaultChecked={normalizedDefaultVisibility === value}
                className="mt-0.5 accent-amber"
              />
              <span className="flex flex-col">
                <span className="font-condensed text-sm font-bold text-ink">
                  {VISIBILITY_COPY[value].label}
                </span>
                <span className="text-xs text-gray-500">
                  {VISIBILITY_COPY[value].hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {state.ok && <span className="text-sm text-leaf-strong">Saved.</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
