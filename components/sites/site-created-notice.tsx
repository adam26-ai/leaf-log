"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { SavedSite } from "@/app/settings/sites/editor-actions";

export function SiteCreatedNotice({ site, onClose }: { site: SavedSite; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const count = site.matchingFlightCount;
  return <>
    <h2 ref={heading} tabIndex={-1} className="font-condensed text-xl font-bold text-ink">{site.name} saved</h2>
    <p className="text-sm text-gray-600">{count == null ? "Review older flights that may use this site."
      : `${count} older ${count === 1 ? "flight" : "flights"} may match this site.`}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
      <Button asChild><Link href={`/sites?review=${encodeURIComponent(site.id)}#review-matching-flights`}>Review matches</Link></Button>
    </div>
  </>;
}
