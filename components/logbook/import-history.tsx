"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useHydrated } from "@/lib/use-hydrated";

export type ImportReceipt = { id: string; filename: string; importedCount: number; skippedCount: number; createdAt: string; undoneAt: string | null; remaining: number };
export function ImportHistory({ imports }: { imports: ImportReceipt[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function undo(id: string) {
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/logbook/imports/${id}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not undo this import.");
      setConfirmId(null); setMessage(`${result.removed} entries removed. ${result.retained} kept because they were changed or have attached content.`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not undo this import."); }
    finally { setPending(false); }
  }
  return <Card className="mt-8 flex flex-col gap-4 p-5"><h2 className="font-condensed text-xl font-bold">Import history</h2>
    {!imports.length && <p className="text-sm text-gray-500">Completed imports will appear here.</p>}
    {imports.map(batch => <div key={batch.id} className="border-t border-gray-200 pt-3 text-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all font-medium">{batch.filename}</p><p className="text-xs text-gray-500">{new Date(batch.createdAt).toISOString().slice(0, 10)} · {batch.importedCount} imported · {batch.skippedCount} skipped · {batch.remaining} remaining</p></div>{batch.undoneAt ? <span className="shrink-0 text-xs text-gray-500">Undone</span> : batch.remaining > 0 && <button disabled={pending || !hydrated} onClick={() => setConfirmId(batch.id)} className="shrink-0 text-brand-blue-strong underline">Undo import</button>}</div>
      {confirmId === batch.id && <div className="mt-3 rounded-lg border border-emergency-orange/25 bg-emergency-orange-light p-3 text-emergency-orange"><p>Remove the unchanged entries from this import? Entries you edited, added an IGC or photos to, or received activity on will be kept.</p><div className="mt-3 flex gap-3"><Button variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>Keep import</Button><Button disabled={pending} onClick={() => void undo(batch.id)}>{pending ? "Removing…" : "Remove unchanged entries"}</Button></div></div>}
    </div>)}
    {message && <p role="status" className="text-sm text-gray-600">{message}</p>}
  </Card>;
}
