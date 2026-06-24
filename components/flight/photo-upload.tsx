"use client";

import { useRef, useState } from "react";

interface UploadResult {
  filename: string;
  status: "placed" | "unplaced" | "skipped_dupe" | "rejected";
  reason?: string;
}

/** Owner-only multi-file photo upload (JPEG/PNG/HEIC). */
export function PhotoUpload({
  flightId,
  onUploaded,
}: {
  flightId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setResults(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch(`/api/flights/${flightId}/photos`, {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      setResults(res.ok ? (json.results ?? []) : [{ filename: "Upload", status: "rejected", reason: json.error ?? "Upload failed" }]);
      if (res.ok) onUploaded();
    } catch {
      setResults([{ filename: "Upload", status: "rejected", reason: "Network error" }]);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const failed = results?.filter((r) => r.status === "rejected") ?? [];
  const ok = results?.filter((r) => r.status !== "rejected").length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="h-9 rounded-md border border-gray-300 bg-paper px-3 font-condensed text-sm font-bold text-ink hover:border-amber disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Add photos"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
          multiple
          hidden
          onChange={onPick}
        />
        <span className="text-xs text-gray-500">JPEG, PNG, or HEIC</span>
      </div>
      {results && (
        <p className="text-xs text-gray-500">
          {ok > 0 && `Added ${ok} photo${ok === 1 ? "" : "s"}.`}
          {failed.length > 0 && (
            <span className="text-red-600">
              {" "}
              {failed.length} couldn&apos;t be added
              {failed[0]?.reason ? ` (${failed[0].reason})` : ""}.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
