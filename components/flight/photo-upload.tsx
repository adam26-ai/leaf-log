"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { uploadPhotoFiles, type PhotoUploadResult } from "./photo-upload-client";

const ACCEPT_EXT = /\.(jpe?g|png|heic|heif)$/i;

/** Owner-only multi-file photo upload (JPEG/PNG/HEIC) — drag-drop or click. */
export function PhotoUpload({
  flightId,
  onUploaded,
}: {
  flightId: string;
  onUploaded: () => void;
}) {
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<PhotoUploadResult[] | null>(null);

  async function uploadFiles(all: File[]) {
    const files = all.filter((f) => f.type.startsWith("image/") || ACCEPT_EXT.test(f.name));
    if (files.length === 0) return;
    setBusy(true);
    setResults(null);
    try {
      const nextResults = await uploadPhotoFiles(flightId, files);
      setResults(nextResults);
      if (nextResults.some((result) => result.status !== "rejected")) onUploaded();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const failed = results?.filter((r) => r.status === "rejected") ?? [];
  const added = results?.filter((r) => r.status === "placed" || r.status === "unplaced").length ?? 0;
  const duplicates = results?.filter((r) => r.status === "skipped_dupe").length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        aria-disabled={!hydrated || busy}
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
          dragging
            ? "border-[var(--replay-accent)] bg-[var(--replay-profile-sky)]/40"
            : "border-[var(--replay-inactive-border)] hover:border-[var(--replay-accent)]",
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
        disabled={!hydrated || busy}
        onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
      />
      {results && (
        <p className="text-xs text-gray-500">
          {added > 0 && `Added ${added} photo${added === 1 ? "" : "s"}.`}
          {duplicates > 0 && ` ${duplicates} ${duplicates === 1 ? "was" : "were"} already on this flight.`}
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
