"use client";

import { useId, useState, type ReactNode } from "react";
import Image from "next/image";
import { Cloud, Eye, Trophy, Users, Waypoints, X } from "lucide-react";
import { WingIcon } from "@/components/icons/wing-icon";
import { useUnits } from "@/lib/flights/use-units";
import { formatAltitude } from "@/lib/flights/format";
import { cn } from "@/lib/utils";

const help = {
  date: ["Date, time & duration", "The first line shows the flight date. Below it are the local takeoff time and time spent flying. Manual entries may show only the details you supplied."],
  site: ["Flying site", "The site name identifies where you took off. When a different landing site is known, it appears after an arrow."],
  altitude: ["Maximum altitude", "The cloud symbol shows the highest altitude recorded during the flight, in your selected units."],
  friends: ["Friend flights", "The wing and people badge means matching friend flights were found. Open the flight to explore flying together in replay."],
  trophies: ["Personal bests", "Trophies mark your top three flights in categories such as duration, altitude, altitude gain, and distance. Gold, silver, and bronze indicate first, second, and third place; the small symbol identifies the category."],
  privacy: ["Flight visibility", "The eye badge shows who can see the flight: a lock for private, people for friends, or a globe for public. This example is visible to friends."],
  source: ["Log source", "The symbol indicates how the log was created: IGC automatically uploaded from a Leaf, IGC manually uploaded, flight details entered by hand, or imported from another logbook."],
} as const;
type Detail = keyof typeof help;

export function LogbookLegend() {
  const { units } = useUnits();
  const id = useId();
  const [pinned, setPinned] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<Detail | null>(null);
  const active = preview ?? pinned;

  function detail(key: Detail, children: ReactNode, className = "") {
    return <button
      type="button"
      aria-label={`Explain ${help[key][0].toLowerCase()}`}
      aria-controls={id}
      aria-expanded={active === key}
      onMouseEnter={() => setPreview(key)}
      onMouseLeave={() => setPreview(null)}
      onFocus={() => setPreview(key)}
      onBlur={() => setPreview(null)}
      onClick={() => { setPreview(null); setPinned(pinned === key ? null : key); }}
      className={cn("rounded-md text-left outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand-blue", className)}
    >{children}</button>;
  }

  function badge(key: "friends" | "trophies" | "privacy" | "source", visibility: string) {
    const symbols = {
      friends: <><WingIcon aria-hidden="true" className="h-5 w-5" /><Users aria-hidden="true" className="h-[17.5px] w-[17.5px]" /></>,
      trophies: <><Trophy aria-hidden="true" className="h-[17.5px] w-[17.5px]" /><Waypoints aria-hidden="true" className="h-[15px] w-[15px]" /></>,
      privacy: <><Eye aria-hidden="true" className="h-[17.5px] w-[17.5px]" /><Users aria-hidden="true" className="h-[17.5px] w-[17.5px]" /></>,
      source: <Image src="/leaf-auto-upload-transparent.png" alt="" width={32} height={32} className="h-8 w-8" />,
    };
    const styles = {
      friends: "h-6 w-11 gap-0.5 rounded-full border border-brand-blue bg-brand-blue text-white",
      trophies: "h-6 w-11 gap-1 rounded-full border border-black/20 bg-[#f5cd57] text-[#563b00]",
      privacy: "h-6 gap-0.5 rounded-full border border-brand-blue bg-brand-blue/10 px-1.5 text-brand-blue-strong",
      source: "h-8 w-8",
    };
    return detail(key, symbols[key], cn("shrink-0 items-center justify-center", styles[key], visibility));
  }

  return (
    <section aria-label="Logbook legend" className="@container/legend min-w-0 border-t border-gray-200 pt-5" onKeyDown={event => {
      if (event.key === "Escape") { setPinned(null); setPreview(null); }
    }}>
      <h3 className="font-condensed text-lg font-bold text-ink">Legend</h3>
      <p className="mb-3 mt-1 text-xs text-gray-500">Mouse over or click on any symbol for details.</p>
      <div aria-label="Legend symbols" className="mb-2 flex flex-wrap items-center gap-2 @min-[560px]/legend:hidden">
        {badge("friends", "inline-flex @min-[560px]/legend:hidden")}
        {badge("trophies", "inline-flex @min-[508px]/legend:hidden")}
        {badge("privacy", "inline-flex @min-[456px]/legend:hidden")}
        {badge("source", "inline-flex @min-[394px]/legend:hidden")}
      </div>
      <div aria-label="Example logbook entry" className="flex min-h-[45px] min-w-0 items-center gap-2 rounded-md border border-gray-200 px-3 py-1 text-sm" style={{ backgroundImage: "linear-gradient(to right, rgb(0 153 255 / 0.18), rgb(148 233 30 / 0.32))" }}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {detail("date", <><span className="block whitespace-nowrap text-[13px] font-bold leading-4">Sat, Jun 6, 2026</span><span className="block whitespace-nowrap text-[13px] leading-4 tabular-nums">12:30 · 2h 15m</span></>, "shrink-0 text-gray-600 @min-[354px]/legend:w-[8.5rem]")}
          {detail("site", <><span className="block font-condensed text-base font-bold leading-4 text-ink">Woodrat</span><span className="block whitespace-nowrap text-xs leading-4 text-gray-600">→ Longsword</span></>, "min-w-0 flex-1")}
          {detail("altitude", <><Cloud aria-hidden="true" className="h-3.5 w-3.5" />{formatAltitude(2100, units)}</>, "ml-auto inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap tabular-nums text-brand-blue-strong")}
        </div>
        {badge("friends", "hidden @min-[560px]/legend:inline-flex")}
        {badge("trophies", "hidden @min-[508px]/legend:inline-flex")}
        {badge("privacy", "hidden @min-[456px]/legend:inline-flex")}
        {badge("source", "hidden @min-[394px]/legend:inline-flex")}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-3 text-[11px] leading-relaxed">
        <p className="text-brand-blue-strong">Blue shading increases with altitude gain and duration</p>
        <p className="text-right text-[#43730d]">Green shading increases with flight distance</p>
      </div>
      {/* Overlapping grid cells reserve the tallest explanation at every width.
          Invisible cells still size the row, so hover never changes page height. */}
      <div id={id} className="mt-3 grid rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600" role="status" aria-live="polite">
        {!active && <p className="col-start-1 row-start-1 self-center text-center text-gray-400">Hover over or select a flight detail to see its explanation here.</p>}
        {(Object.keys(help) as Detail[]).map(key => (
          <div key={key} aria-hidden={active !== key} className={cn("col-start-1 row-start-1 min-w-0", active !== key && "invisible pointer-events-none")}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <strong className="text-sm text-ink">{help[key][0]}</strong>
              <button type="button" tabIndex={active === key ? 0 : -1} aria-label="Close legend explanation" onClick={() => { setPinned(null); setPreview(null); }} className="rounded p-1 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-blue"><X aria-hidden="true" className="h-4 w-4" /></button>
            </div>
            <p>{help[key][1]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
