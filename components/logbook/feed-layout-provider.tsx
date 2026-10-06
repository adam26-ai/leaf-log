"use client";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { feedLayout } from "@/lib/flights/feed-layout";
import type { FlightTrophy } from "@/lib/flights/trophies";

const Context = createContext<ReturnType<typeof feedLayout> | null>(null);
export function useFeedLayout(trophies: FlightTrophy[]) {
  return useContext(Context) ?? feedLayout(830, [trophies]);
}
export function FeedLayoutProvider({ trophySets, children }: { trophySets: FlightTrophy[][]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1104);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const pilot = Math.max(112, Math.min(176, width * .16));
  const gap = Math.max(4, Math.min(12, width * .012));
  const layout = feedLayout(Math.max(0, width - pilot - 40 - gap * 2), trophySets);
  return <Context.Provider value={layout}><div ref={ref} data-feed-pilot-compact={width < 600} style={{ "--feed-pilot": `${pilot}px`, "--feed-row-gap": `${gap}px` } as CSSProperties}>
    {children}
  </div></Context.Provider>;
}
