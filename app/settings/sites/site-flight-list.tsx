"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDuration } from "@/lib/flights/format";
import type { SiteFlightDetails, SiteFlightPage } from "@/lib/sites/manage";
import { listSiteFlightsAction, type SiteManagerResult } from "./actions";

export function SiteFlightSummary({ flight }: { flight: SiteFlightDetails }) {
  const source = flight.source === "csv_import" ? "CSV import" : flight.source === "web_upload" ? "IGC upload" : flight.source === "device_push" ? "Device upload" : "Manual entry";
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="font-medium text-ink">{flight.date ?? "Undated flight"}{flight.time ? ` · ${flight.time}` : ""}</span>
      <Link href={`/flights/${flight.id}`} className="shrink-0 text-xs text-brand-blue-strong underline" aria-label={`View flight ${flight.date ?? "without a date"}${flight.time ? ` at ${flight.time}` : ""}`}>View flight</Link>
    </div>
    <p className="mt-1 text-xs text-gray-500">{[source, flight.glider, flight.durationS !== null ? formatDuration(flight.durationS) : null].filter(Boolean).join(" · ")}</p>
  </div>;
}

export function SiteFlightList({ siteId, count, revision }: { siteId: string; count: number; revision: number }) {
  const panelId = useId();
  const headingId = useId();
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const key = `${revision}:${page}:${retry}`;
  const [loaded, setLoaded] = useState<{ key: string; result: SiteManagerResult<SiteFlightPage> } | null>(null);
  const result = loaded?.key === key ? loaded.result : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSiteFlightsAction(siteId, page)
      .then(result => { if (!cancelled) setLoaded({ key, result }); })
      .catch(() => { if (!cancelled) setLoaded({ key, result: { ok: false, error: "Could not load flights. Please try again." } }); });
    return () => { cancelled = true; };
  }, [siteId, page, open, key]);

  return <Card className="overflow-hidden">
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 p-5 text-left hover:bg-gray-50">
          <span className="font-condensed text-xl font-bold text-ink">Flights at this site <span className="ml-1 text-gray-500">({count})</span></span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </h3>
      {open && <div id={panelId} className="border-t border-gray-200 p-5">
        <p className="mb-4 text-sm text-gray-600">Your flights that use this site. Each flight appears once, even when both takeoff and landing are here.</p>
        {!result && <p className="text-sm text-gray-500" role="status">Loading flights…</p>}
        {result && !result.ok && <div className="text-sm"><p role="alert">{result.error}</p><Button type="button" variant="outline" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
        {result?.ok && <>
          {result.value.total === 0 ? <p className="text-sm text-gray-500">No flights use this site yet. Review matching flights below to find flights you can assign to this site.</p> : <ul className="max-h-96 overflow-y-auto rounded-md border border-gray-200">
            {result.value.flights.map(flight => <li key={flight.id} className="border-b border-gray-100 p-3 text-sm last:border-0">
              <SiteFlightSummary flight={flight} />
              <p className="mt-2 text-xs font-medium text-brand-blue-strong">{flight.endpoints.length === 2 ? "Takeoff and landing" : flight.endpoints[0] === "takeoff" ? "Takeoff" : "Landing"} · Uses this site</p>
            </li>)}
          </ul>}
          {result.value.pageCount > 1 && <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-500">
            <Button type="button" variant="outline" size="sm" disabled={result.value.page === 1} onClick={() => setPage(result.value.page - 1)}>Previous</Button>
            <span>Page {result.value.page} of {result.value.pageCount} · {result.value.total} flights</span>
            <Button type="button" variant="outline" size="sm" disabled={result.value.page === result.value.pageCount} onClick={() => setPage(result.value.page + 1)}>Next</Button>
          </div>}
        </>}
      </div>}
    </section>
  </Card>;
}
