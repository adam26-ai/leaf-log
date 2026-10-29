"use client";

import { useId, useState, type ReactNode } from "react";
import Image from "next/image";
import { Cloud, Route, Trophy, Users, Waypoints, X } from "lucide-react";
import { WingPairIcon } from "@/components/icons/wing-icon";
import { useUnits } from "@/lib/flights/use-units";
import { formatAltitude, formatDistance } from "@/lib/flights/format";
import { cn } from "@/lib/utils";
import card from "@/components/logbook/logbook-flight-card.module.css";
import css from "./logbook-legend.module.css";

const help = {
  date: ["Date, time & duration", "The first line shows the flight date. Below it are the local takeoff time and time spent flying. Manual entries may show only the details you supplied."],
  site: ["Flying site", "The site name identifies where you took off. When a different landing site is known, it appears after an arrow."],
  altitude: ["Maximum altitude", "The cloud symbol shows the highest altitude recorded during the flight, in your selected units."],
  distance: ["XC distance", "The route symbol shows the largest available XC distance in your selected units. This can be calculated from an IGC recording or reported by the pilot. A dash means no XC distance is recorded."],
  friends: ["Friend flights", "The two-paraglider badge means you flew together with a friend. Open the flight to explore the matching friend flights in replay."],
  trophies: ["Personal bests", "Trophies mark your top three flights in categories such as duration, altitude, altitude gain, and distance. Gold, silver, and bronze indicate first, second, and third place. When space is tight, the badge becomes a single trophy icon; hover over it in your logbook to see all awards and categories."],
  privacy: ["Flight visibility", "The round visibility badge shows who can see the flight: a lock for private, people for friends, or a globe for public. This example is visible to friends."],
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

  function badge(key: "friends" | "trophies" | "privacy" | "source") {
    const symbols = {
      friends: <WingPairIcon aria-hidden="true" className="h-6 w-6" />,
      trophies: <><Trophy aria-hidden="true" className="h-[17.5px] w-[17.5px]" /><Waypoints aria-hidden="true" className={cn("h-[15px] w-[15px]", css.trophyCategory)} /></>,
      privacy: <Users aria-hidden="true" className="h-[15px] w-[15px]" />,
      source: <Image src="/leaf-auto-upload-transparent.png" alt="" width={32} height={32} className={css.sourceImage} />,
    };
    const styles = {
      friends: cn("h-6 rounded-full border border-brand-blue bg-brand-blue text-white", css.friendBadge),
      trophies: cn("h-6 gap-1 rounded-full border border-black/20 bg-[#f5cd57] text-[#563b00]", css.trophyBadge),
      privacy: "h-6 w-6 rounded-full border border-brand-blue bg-brand-blue/10 text-brand-blue-strong",
      source: css.source,
    };
    return detail(key, symbols[key], cn("inline-flex shrink-0 items-center justify-center", styles[key]));
  }

  return (
    <section aria-label="Logbook legend" className="@container/legend min-w-0 border-t border-gray-200 pt-5" onKeyDown={event => {
      if (event.key === "Escape") { setPinned(null); setPreview(null); }
    }}>
      <h3 className="font-condensed text-lg font-bold text-ink">Legend</h3>
      <p className="mb-3 mt-1 text-xs text-gray-500">Mouse over or click on any symbol for details.</p>
      <div className={card.row}>
      <div aria-label="Example logbook entry" className={cn(card.card, css.sample)} style={{ backgroundImage: "linear-gradient(to right, rgb(0 153 255 / 0.18), rgb(148 233 30 / 0.32))" }}>
        {detail("date", <><span className="font-bold"><span className={card.dateFull}>Sat, Jun 6, 2026</span><span className={card.dateShort}>Sat, Jun 6</span></span><span>12:30 · 2h 15m</span></>, card.date)}
        {detail("site", <><span>Woodrat</span><span>→ Longsword</span></>, card.site)}
        <div className={cn(card.metrics, css.metrics)}>
          {detail("altitude", <><Cloud aria-hidden="true" />{formatAltitude(2100, units)}</>, card.metric)}
          {detail("distance", <><Route aria-hidden="true" />{formatDistance(18500, units)}</>, card.metric)}
        </div>
        <div className={css.badges}>
          <div className={card.friends}>{badge("friends")}</div>
          <div className={cn(card.trophies, css.trophySlot)}>{badge("trophies")}</div>
          <div className={card.extras}>{badge("privacy")}{badge("source")}</div>
        </div>
      </div>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-3 text-[11px] leading-relaxed">
        <p className="text-brand-blue-strong">Blue shading increases with altitude gain and duration</p>
        <p className="text-right text-[#43730d]">Green shading increases with flight distance</p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-500">Your totals and filters stay visible while you scroll through flights. Use <strong className="font-medium text-gray-600">Edit logbook</strong> to edit individual flights or several selected flights together. Changes stay in a draft until you review and save them.</p>
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
