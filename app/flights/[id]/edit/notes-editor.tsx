"use client";

import { useEffect, useRef, useState } from "react";
import { updateNotes } from "./actions";

/** Debounced, serialized saves keep newer notes from being overwritten. */
export function NotesEditor({ flightId, notes }: { flightId: string; notes: string }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const latestRevision = useRef(0);
  const submittedRevision = useRef(0);
  const [revision, setRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [flush, setFlush] = useState(false);
  const [status, setStatus] = useState("Changes save automatically");
  const [error, setError] = useState(false);

  function changed() {
    latestRevision.current += 1;
    setRevision(latestRevision.current);
    setFlush(false);
    setStatus("Unsaved changes…");
    setError(false);
  }

  useEffect(() => {
    if (saving || revision <= submittedRevision.current) return;
    const timer = window.setTimeout(async () => {
      if (!inputRef.current) return;
      const data = new FormData();
      data.set("notes", inputRef.current.value);
      submittedRevision.current = revision;
      setSaving(true);
      setStatus("Saving…");
      try {
        const result = await updateNotes(flightId, {}, data);
        if (result.ok) setSavedRevision(revision);
        if (latestRevision.current === revision) {
          setStatus(result.ok ? "Changes saved" : result.error ?? "Couldn't save changes.");
          setError(!result.ok);
        }
      } catch {
        if (latestRevision.current === revision) {
          setStatus("Couldn't save changes.");
          setError(true);
        }
      } finally {
        setSaving(false);
      }
    }, flush ? 0 : 700);
    return () => window.clearTimeout(timer);
  }, [flightId, revision, saving, flush]);

  useEffect(() => {
    if (revision <= savedRevision) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [revision, savedRevision]);

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={inputRef}
        aria-label="Flight notes"
        aria-describedby="flight-notes-status"
        name="notes"
        defaultValue={notes}
        onChange={changed}
        onBlur={() => setFlush(true)}
        maxLength={2000}
        rows={5}
        placeholder="Conditions, line choices, what you'd do differently — anything worth remembering next time you fly here."
        className="resize-none rounded-md border border-[var(--replay-inactive-border)] bg-paper px-3 py-2 text-ink outline-none focus:border-[var(--replay-accent)] focus:ring-2 focus:ring-[var(--replay-accent)]/30"
      />
      <div id="flight-notes-status" role="status" aria-live="polite" className={`text-xs ${error ? "text-red-600" : "text-gray-500"}`}>
        {status}
        {error && <button type="button" onClick={() => { changed(); setFlush(true); }} className="ml-2 underline">Retry</button>}
      </div>
    </div>
  );
}
