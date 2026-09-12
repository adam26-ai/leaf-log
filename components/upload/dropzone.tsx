"use client";

import Link from "next/link";
import { FlightTypeFields } from "@/components/flight/type-flags";
import type { FlightFlag } from "@/lib/flights/type-flags";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IgcComparison, type IgcComparisonPreview } from "@/components/logbook/igc-comparison";
import type { IgcDuplicateCandidate } from "@/lib/logbook/igc-duplicates";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";

type UploadResult = {
  filename: string;
  flightId?: string;
  status?: "ready" | "failed";
  deduped?: boolean;
  possibleDuplicates?: IgcDuplicateCandidate[];
  error?: string;
};

type ActiveComparison = {
  resultIndex: number;
  candidateId: string;
  preview: IgcComparisonPreview;
};

export function Dropzone() {
  const [flags, setFlags] = useState<FlightFlag[]>([]);
  const hydrated = useHydrated();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [comparison, setComparison] = useState<ActiveComparison | null>(null);
  const [actionError, setActionError] = useState("");

  function openFlight(flightId: string) {
    router.push(`/flights/${flightId}`);
    router.refresh();
  }

  function discard(resultIndex: number) {
    setComparison(null);
    setActionError("");
    setFiles((current) => current.filter((_, index) => index !== resultIndex));
    setResults((current) => {
      const remaining = current?.filter((_, index) => index !== resultIndex) ?? [];
      return remaining.length ? remaining : null;
    });
  }

  async function upload(selected: FileList | File[], allowPossibleDuplicate = false, resultIndex?: number) {
    const list = Array.from(selected).filter((file) => file.name.toLowerCase().endsWith(".igc"));
    if (list.length === 0) {
      setResults([{ filename: "—", error: "Please choose .igc files." }]);
      return;
    }
    setBusy(true);
    setActionError("");
    setComparison(null);
    if (resultIndex == null) {
      setFiles(list);
      setResults(null);
    }
    const form = new FormData();
    list.forEach((file) => form.append("files", file));
    flags.forEach(flag => form.append("flightFlags", flag));
    if (allowPossibleDuplicate) form.set("allowPossibleDuplicate", "true");

    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = await response.json();
      const nextResults: UploadResult[] = data.results ?? [
        { filename: "—", error: data.error ?? "Upload failed." },
      ];
      if (resultIndex == null) {
        setResults(nextResults);
      } else {
        setResults((current) => current?.map((result, index) => index === resultIndex ? nextResults[0] : result) ?? nextResults);
      }

      const successful = nextResults.filter((result) => result.flightId);
      if ((resultIndex != null || nextResults.length === 1) && successful.length === 1) {
        openFlight(successful[0].flightId!);
      }
    } catch {
      const failed = { filename: list[0]?.name ?? "—", error: "Upload failed. Please try again." };
      if (resultIndex == null) setResults([failed]);
      else setResults((current) => current?.map((result, index) => index === resultIndex ? failed : result) ?? [failed]);
    } finally {
      setBusy(false);
    }
  }

  async function compare(resultIndex: number, candidateId: string) {
    const file = files[resultIndex];
    if (!file) return;
    setBusy(true);
    setActionError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("operation", "preview");
      const response = await fetch(`/api/flights/${candidateId}/attach-igc`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not compare these flights.");
      setComparison({ resultIndex, candidateId, preview: result });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not compare these flights.");
    } finally {
      setBusy(false);
    }
  }

  async function attach(active: ActiveComparison) {
    const file = files[active.resultIndex];
    if (!file || !active.preview.mergeable) return;
    setBusy(true);
    setActionError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("operation", "commit");
      body.set("hash", active.preview.hash);
      body.set("expectedUpdatedAt", active.preview.expectedUpdatedAt);
      const response = await fetch(`/api/flights/${active.candidateId}/attach-igc`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setComparison(null);
        throw new Error(result.error ?? "Could not attach this recording.");
      }
      setResults(current => current?.map((row, index) => index === active.resultIndex ? { filename: row.filename, flightId: result.id, status: "ready" } : row) ?? null);
      setComparison(null);
      if (results?.length === 1) openFlight(result.id);
      else router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not attach this recording.");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      <FlightTypeFields value={flags} onChange={setFlags} disabled={busy || Boolean(results)} />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) void upload(event.dataTransfer.files);
        }}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors",
          dragging
            ? "border-brand-blue bg-brand-blue/5"
            : "border-gray-300 hover:border-brand-blue hover:bg-gray-50",
          busy && "cursor-wait opacity-60",
        )}
      >
        <p className="font-condensed text-2xl font-bold text-ink">
          {busy ? "Working…" : "Drop your IGC file here"}
        </p>
        <p className="text-gray-600">Or click to choose a file from your device.</p>
        <input
          ref={inputRef}
          aria-label="IGC files"
          type="file"
          accept=".igc"
          multiple
          hidden
          disabled={!hydrated || busy}
          onChange={(event) => event.target.files && void upload(event.target.files)}
        />
      </div>

      {results && (
        <ul className="flex flex-col gap-3">
          {results.map((result, resultIndex) => {
            const active = comparison?.resultIndex === resultIndex ? comparison : null;
            if (result.possibleDuplicates?.length) {
              return (
                <li key={`${result.filename}-${resultIndex}`} className="rounded-lg border border-emergency-orange/30 bg-emergency-orange-light/40 p-4 text-sm">
                  <p className="break-all font-mono text-gray-700">{result.filename}</p>
                  <h3 className="mt-3 font-condensed text-lg font-bold text-ink">Overlapping flight found</h3>
                  <p className="mt-1 text-gray-600">
                    Compare the recording with your existing flight. Attach it to an entry without an IGC, keep it as a separate flight, or discard the upload.
                  </p>
                  <div className="mt-4 flex flex-col gap-3">
                    {result.possibleDuplicates.map((candidate) => (
                      <div key={candidate.id} className="rounded-md border border-emergency-orange/20 bg-paper p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-ink">
                              {candidate.date || "Date unknown"}{candidate.time ? ` · ${candidate.time}` : ""} · {candidate.site ?? "Unknown site"} · {candidate.wing ?? "Unknown wing"}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {candidate.recordingKind === "logbook" ? "Logbook entry without an IGC" : "Flight with an IGC recording"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void compare(resultIndex, candidate.id)}>
                              Compare
                            </Button>
                            <Button asChild size="sm" variant="ghost">
                              <Link href={`/flights/${candidate.id}`} target="_blank">View existing</Link>
                            </Button>
                          </div>
                        </div>
                        {active?.candidateId === candidate.id && (
                          <div className="mt-4 border-t border-gray-200 pt-4">
                            <IgcComparison
                              preview={active.preview}
                              pending={busy}
                              existingColumnLabel="Existing flight"
                              uploadedColumnLabel="Uploaded IGC"
                              onMerge={() => void attach(active)}
                              mergeLabel="Add uploaded IGC to this flight"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void upload([files[resultIndex]], true, resultIndex)}
                    >
                      Keep this uploaded flight
                    </Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => discard(resultIndex)}>
                      Discard this upload
                    </Button>
                  </div>
                </li>
              );
            }
            return (
              <li key={`${result.filename}-${resultIndex}`} className="flex items-center justify-between gap-4 rounded-md border border-gray-200 px-4 py-2 text-sm">
                <span className="break-all font-mono text-gray-700">{result.filename}</span>
                {result.error ? (
                  <span className="text-red-600">{result.error}</span>
                ) : result.deduped ? (
                  <span className="text-gray-500">Already uploaded · <Link href={`/flights/${result.flightId}`} className="text-brand-blue-strong underline underline-offset-2">View flight</Link></span>
                ) : result.status === "failed" ? (
                  <span className="text-brand-blue-strong">Couldn&apos;t read flight</span>
                ) : (
                  <Link href={`/flights/${result.flightId}`} className="text-brand-blue-strong">View flight →</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}

      <div>
        <Button onClick={() => inputRef.current?.click()} disabled={!hydrated || busy}>Choose file</Button>
      </div>
    </div>
  );
}
