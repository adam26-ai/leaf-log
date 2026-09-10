"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

export function ExportLogbook({ align = "end" }: { align?: "start" | "end" }) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div ref={root} className="relative">
    <Button ref={trigger} type="button" variant="outline" size="sm" disabled={!hydrated} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <Download className="h-4 w-4" aria-hidden="true" />Export logbook
    </Button>
    {open && <div id={panelId} className={`absolute ${align === "start" ? "left-0 sm:left-auto sm:right-0" : "right-0"} top-full z-50 mt-2 w-72 max-w-[85vw] rounded-lg border border-gray-200 bg-white p-3 shadow-lg`}>
      <p className="mb-2 text-xs text-gray-500">Export all your flights, including those hidden by filters.</p>
      <a href="/api/logbook/export?format=csv" download className="block rounded-md px-2 py-3 text-sm hover:bg-gray-50 focus-visible:outline-brand-blue">
        <span className="block font-medium text-ink">Download CSV</span>
        <span className="mt-1 block text-xs text-gray-500">Flight details, notes, and matching IGC filenames.</span>
      </a>
      <a href="/api/logbook/export?format=igc" download className="block rounded-md px-2 py-3 text-sm hover:bg-gray-50 focus-visible:outline-brand-blue">
        <span className="block font-medium text-ink">Download IGC ZIP</span>
        <span className="mt-1 block text-xs text-gray-500">All stored original recordings. Flights without an IGC are omitted.</span>
      </a>
    </div>}
  </div>;
}
