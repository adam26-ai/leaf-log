"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import type { SitePoint } from "@/lib/sites/model";
import type { MapSite } from "./site-browser-map";

const BrowserMap = dynamic(() => import("./site-browser-map").then(module => module.SiteBrowserMap), {
  ssr: false, loading: () => <div className="grid aspect-[7/5] place-content-center bg-gray-100 text-sm text-gray-500">Loading map...</div>,
});

export function SiteMapPanel({ sites, selectedId, initialPoint, onSelect, heading = "Site map", actions, children }: {
  sites: MapSite[]; selectedId: string | null; initialPoint: SitePoint | null; onSelect: (id: string) => void;
  heading?: string; actions?: ReactNode; children?: ReactNode;
}) {
  return <section aria-label="Site map" className="overflow-hidden rounded-xl border border-gray-200 bg-paper shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0"><h2 className="break-words font-condensed text-2xl font-bold">{heading}</h2>
        <p className="text-xs text-gray-500">All public sites and your private sites</p></div>
      {actions}
    </div>
    {children}
    <BrowserMap sites={sites} selectedId={selectedId} initialPoint={initialPoint} onSelect={onSelect} />
    <div className="flex flex-wrap gap-4 px-5 py-3 text-xs text-gray-600">
      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand-blue" />Public sites</span>
      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-violet-600" />Your private sites</span>
    </div>
  </section>;
}
