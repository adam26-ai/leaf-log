"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UploadResult = {
  filename: string;
  flightId?: string;
  status?: "ready" | "failed";
  deduped?: boolean;
  error?: string;
};

export function Dropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".igc"),
    );
    if (list.length === 0) {
      setResults([{ filename: "—", error: "Please choose .igc files" }]);
      return;
    }
    setBusy(true);
    setResults(null);
    const form = new FormData();
    list.forEach((f) => form.append("files", f));

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      const rs: UploadResult[] = data.results ?? [
        { filename: "—", error: data.error ?? "Upload failed" },
      ];
      setResults(rs);

      // Single successful flight → jump straight to it.
      const ok = rs.filter((r) => r.flightId);
      if (ok.length === 1) {
        router.push(`/flights/${ok[0].flightId}`);
        router.refresh();
      }
    } catch {
      setResults([{ filename: "—", error: "Upload failed — please try again" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors",
          dragging
            ? "border-amber bg-amber/5"
            : "border-gray-300 hover:border-amber hover:bg-gray-50",
        )}
      >
        <p className="font-condensed text-2xl font-bold text-ink">
          {busy ? "Uploading…" : "Drop your IGC file here"}
        </p>
        <p className="text-gray-600">
          or click to choose a file from your device
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".igc"
          multiple
          hidden
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>

      {results && (
        <ul className="flex flex-col gap-2">
          {results.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-2 text-sm"
            >
              <span className="font-mono text-gray-700">{r.filename}</span>
              {r.error ? (
                <span className="text-red-600">{r.error}</span>
              ) : r.deduped ? (
                <span className="text-gray-500">Already uploaded</span>
              ) : r.status === "failed" ? (
                <span className="text-amber-strong">Couldn&apos;t read flight</span>
              ) : (
                <a href={`/flights/${r.flightId}`} className="text-leaf-strong">
                  View flight →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose file
        </Button>
      </div>
    </div>
  );
}
