"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface UploadResult {
  filename: string;
  status: "placed" | "unplaced" | "skipped_dupe" | "rejected";
  reason?: string;
}

const ACCEPT_EXT = /\.(jpe?g|png|heic|heif)$/i;

/** Owner-only multi-file photo upload (JPEG/PNG/HEIC) — drag-drop or click. */
export function PhotoUpload({
  flightId,
  onUploaded,
}: {
  flightId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);

  async function uploadFiles(all: File[]) {
    const files = all.filter((f) => f.type.startsWith("image/") || ACCEPT_EXT.test(f.name));
    if (files.length === 0) return;
    setBusy(true);
    setResults(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch(`/api/flights/${flightId}/photos`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      setResults(
        res.ok
          ? (json.results ?? [])
          : [{ filename: "Upload", status: "rejected", reason: json.error ?? "Upload failed" }],
      );
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
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-amber bg-amber/10" : "border-gray-300 hover:border-amber",
          busy && "pointer-events-none opacity-50",
        )}
      >
        <span className="font-condensed text-sm font-bold text-ink">
          {busy ? "Uploading…" : "Add photos"}
        </span>
        <span className="text-xs text-gray-500">
          Drag &amp; drop or click · JPEG, PNG, or HEIC
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
        multiple
        hidden
        onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
      />
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
