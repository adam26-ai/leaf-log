"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { IgcComparison, type IgcComparisonPreview } from "./igc-comparison";

export function AttachIgcForm({ flightId }: { flightId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<IgcComparisonPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function chooseFile(nextFile: File | undefined) {
    setPreview(null);
    setError("");
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!nextFile.name.toLowerCase().endsWith(".igc")) {
      setFile(null);
      setError("Please choose an .igc file.");
      return;
    }
    setFile(nextFile);
  }

  async function submit(commit: boolean) {
    if (!file) return;
    setPending(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("operation", commit ? "commit" : "preview");
      if (preview) {
        body.set("hash", preview.hash);
        body.set("expectedUpdatedAt", preview.expectedUpdatedAt);
      }
      const response = await fetch(`/api/flights/${flightId}/attach-igc`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setPreview(null);
        throw new Error(result.error ?? "Could not attach this recording.");
      }
      if (result.attached) {
        router.push(`/flights/${flightId}`);
        router.refresh();
      } else {
        setPreview(result);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not attach this recording.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-gray-600">
        Found the recording? Add it to this flight to enable replay. Review the measured details before replacing the entered values.
      </p>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!pending) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!pending) chooseFile(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-5 py-8 text-center transition-colors",
          dragging
            ? "border-[var(--replay-accent)] bg-[var(--replay-profile-sky)]/40"
            : "border-[var(--replay-inactive-border)] bg-gray-50/50",
          pending && "opacity-60",
        )}
      >
        <CloudUpload className="h-8 w-8 text-[var(--replay-accent-strong)]" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-condensed text-base font-bold text-ink">Drop an IGC file here</p>
          <p className="text-xs text-gray-500">IGC flight recording files only</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !hydrated}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>
        {file && (
          <p className="max-w-full break-all text-xs text-gray-700" aria-live="polite">
            Selected: <span className="font-medium text-ink">{file.name}</span>
          </p>
        )}
        <input
          ref={inputRef}
          aria-label="IGC to attach"
          type="file"
          accept=".igc"
          hidden
          disabled={pending || !hydrated}
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
      </div>
      {file && !preview && (
        <Button className="self-start" variant="outline" disabled={pending} onClick={() => void submit(false)}>
          {pending ? "Reading…" : "Compare IGC with this entry"}
        </Button>
      )}
      {preview && <IgcComparison preview={preview} pending={pending} onMerge={() => void submit(true)} />}
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
  );
}
