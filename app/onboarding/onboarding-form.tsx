"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { AccentBar } from "@/components/ui/accent-bar";
import { completeOnboarding, type OnboardingState } from "./actions";

const initial: OnboardingState = {};

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(
    completeOnboarding,
    initial,
  );

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-condensed text-3xl font-bold text-ink">
          Set up your pilot profile
        </h1>
        <AccentBar className="mx-auto" />
        <p className="text-gray-600">
          Pick a handle and a display name. This is how the community will find you.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Handle
        </span>
        <div className="flex items-center rounded-md border border-gray-300 bg-paper focus-within:border-amber focus-within:ring-2 focus-within:ring-amber/40">
          <span className="pl-3 font-mono text-gray-500">@</span>
          <input
            name="handle"
            required
            autoFocus
            placeholder="skyhawk"
            pattern="[A-Za-z0-9_]{3,20}"
            className="h-11 w-full bg-transparent px-2 font-mono text-ink outline-none"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Display name
        </span>
        <input
          name="display_name"
          required
          placeholder="Alex Pilot"
          maxLength={60}
          className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
        />
      </label>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating…" : "Create my logbook"}
      </Button>
      {state.error && (
        <p className="text-center text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}
