"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { AvatarUploader } from "./avatar-uploader";
import {
  FLIGHT_VISIBILITIES,
  normalizeVisibility,
  type FlightVisibility,
} from "@/lib/flights/visibility";
import { updateProfile } from "./actions";

import { MapDefaultsFields } from "./map-defaults-fields";


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
  defaultUnits,
  customUnits,
  mapDefaults,
  avatarUpdatedAt,
  afterProfile,
}: {
  handle: string;
  displayName: string;
  bio: string;
  defaultVisibility: string;
  defaultUnits: string;
  customUnits?: unknown;
  mapDefaults: unknown;
  avatarUpdatedAt: Date | string | null;
  afterProfile?: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const latestRevision = useRef(0);
  const submittedRevision = useRef(0);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Changes save automatically");
  const [error, setError] = useState(false);
  function changed() {
    latestRevision.current += 1;
    setRevision(latestRevision.current);
    setStatus("Unsaved changes…");
    setError(false);
  }

  // Debounce typing and serialize writes so an older request cannot overwrite
  // newer edits. Any edits during a request are saved in the next pass.
  useEffect(() => {
    if (saving || revision <= submittedRevision.current) return;
    const timer = window.setTimeout(async () => {
      const form = formRef.current;
      if (!form) return;
      const invalid = Array.from(form.elements).find(el =>
        el instanceof HTMLInputElement && !el.validity.valid) as HTMLInputElement | undefined;
      if (invalid) {
        setStatus(`${invalid.name === "handle" ? "Handle" : "Display name"}: ${invalid.validationMessage}`);
        setError(true);
        return;
      }
      submittedRevision.current = revision;
      setSaving(true);
      setStatus("Saving…");
      try {
        const result = await updateProfile({}, new FormData(form));
        if (latestRevision.current === revision) {
          setStatus(result.error ?? "Saved");
          setError(Boolean(result.error));
        }
      } catch {
        if (latestRevision.current === revision) {
          setStatus("Couldn't save. Please retry.");
          setError(true);
        }
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [revision, saving]);

  const saveStatus = <div role="status" aria-live="polite" className={`text-xs ${error ? "text-red-600" : "text-gray-500"}`}>
    {status}{error && <button type="button" onClick={changed} className="ml-2 underline">Retry</button>}
  </div>;
  const normalizedDefaultVisibility = normalizeVisibility(defaultVisibility);

  return (
    <form ref={formRef} onSubmit={e => { e.preventDefault(); changed(); }} onChange={e => {
      const target = e.target;
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) && target.name) changed();
    }} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-3">
          <h2 className="font-condensed text-lg font-bold text-ink">Profile</h2>
          <AvatarUploader handle={handle} displayName={displayName} avatarUpdatedAt={avatarUpdatedAt} />
        </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Handle
        </span>
        <div className="flex items-center rounded-md border border-gray-300 bg-paper focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/40">
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
          className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/40"
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
          className="resize-none rounded-md border border-gray-300 bg-paper px-3 py-2 text-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/40"
        />
      </label>

      {saveStatus}
      </Card>
      {afterProfile}
      <Card className="flex flex-col gap-5 p-6">
      <h2 className="font-condensed text-lg font-bold text-ink">Logbook</h2>
      <Link href="/settings/import" className="rounded-lg border border-gray-200 p-4 text-sm hover:border-brand-blue"><span className="block font-medium text-ink">Import an existing logbook</span><span className="mt-1 block text-xs text-gray-500">Download a CSV template, review your earlier flights, and bring them into Leaf Log.</span></Link>
      <MapDefaultsFields units={defaultUnits} customUnits={customUnits} defaults={mapDefaults} onChange={changed} />

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
              className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-paper px-3 py-2.5 hover:border-brand-blue has-[:checked]:border-brand-blue has-[:checked]:bg-brand-blue/5"
            >
              <input
                type="radio"
                name="default_visibility"
                value={value}
                defaultChecked={normalizedDefaultVisibility === value}
                className="mt-0.5 accent-brand-blue"
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
      {saveStatus}
      </Card>
    </form>
  );
}
