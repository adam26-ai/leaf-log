"use client";

import { useEffect, useRef, useState } from "react";
import type { FlightTrophy } from "@/lib/flights/trophies";
import { trophyGroups } from "@/lib/flights/trophy-groups";
import { TrophyPill } from "./trophy-pill";

export function ResponsiveTrophies({ trophies }: { trophies: FlightTrophy[] }) {
  const container = useRef<HTMLSpanElement>(null);
  const [slots, setSlots] = useState(1);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      // Each fixed-width pill is 44px; adjacent pills have a 4px gap.
      setSlots(Math.max(1, Math.floor((entry.contentRect.width + 4) / 48)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <span ref={container} className="flex min-w-0 items-center gap-1" aria-label="Flight trophies">
    {trophyGroups(trophies, slots).map(group => <TrophyPill key={group.map(trophy => trophy.category).join(",")} trophies={group} />)}
  </span>;
}
