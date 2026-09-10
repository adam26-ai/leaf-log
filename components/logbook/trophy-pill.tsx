"use client";
import { Clock, Cloud, Mountain, Waypoints, Triangle, TriangleRight, Trophy, Plus } from "lucide-react";
import { TROPHY_LABELS, type FlightTrophy } from "@/lib/flights/trophies";
import { formatAltitude, formatDistance, formatDuration } from "@/lib/flights/format";
import { useUnits } from "@/lib/flights/use-units";

const icons = { duration: Clock, altitude: Cloud, "launch-gain": Mountain, open: Waypoints, "fai-triangle": Triangle, "free-triangle": TriangleRight };
const medals = { 1: "Gold", 2: "Silver", 3: "Bronze" };
const colors = { 1: "bg-[#f5cd57] text-[#563b00]", 2: "bg-[#dce2e8] text-[#394452]", 3: "bg-[#c99362] text-[#40240e]" };

export function TrophyPill({ trophies }: { trophies: FlightTrophy[] }) {
  const { units } = useUnits();
  if (!trophies.length) return null;
  const first = trophies[0], multiple = trophies.length > 1;
  const bestRank = trophies.reduce((best, trophy) => trophy.rank < best ? trophy.rank : best, first.rank);
  const Icon = icons[first.category];
  const records = [...trophies].sort((a, b) => a.rank - b.rank).map(t => ({ ...t,
    valueLabel: t.category === "duration" ? formatDuration(t.value) : t.category === "altitude" || t.category === "launch-gain" ? formatAltitude(t.value, units) : formatDistance(t.value, units),
  }));
  const descriptions = records.map(t => `${medals[t.rank]} — ${TROPHY_LABELS[t.category]}: ${t.valueLabel}${t.reported ? " (reported)" : t.approximate ? " (best found)" : ""}`);
  return <span tabIndex={0} aria-label={descriptions.join("; ")} className="group/trophy relative inline-flex justify-center outline-none">
    <span data-medal={medals[bestRank].toLowerCase()} className={`inline-flex h-6 items-center gap-1 rounded-full border border-black/20 px-1.5 ${colors[bestRank]}`}>
      <Trophy className="h-3.5 w-3.5" />{multiple ? <Plus className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
    </span>
    <span role="tooltip" className="pointer-events-none absolute right-0 bottom-full z-40 mb-2 hidden w-72 max-w-[85vw] overflow-hidden rounded-xl border border-white/10 bg-gray-900 text-left text-xs font-normal text-white shadow-xl group-hover/trophy:block group-focus/trophy:block">
      <span className="block border-b border-white/15 px-3 py-2 font-condensed text-lg font-bold tracking-wide">Personal Bests</span>
      <span className="block px-3 py-1">
        {records.map(record => {
          const CategoryIcon = icons[record.category];
          return <span key={record.category} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/10 py-2 last:border-0">
            <span title={medals[record.rank]} className={`inline-flex h-7 items-center justify-center gap-1 rounded-full ${colors[record.rank]}`}>
              <Trophy className="h-3.5 w-3.5" /><CategoryIcon className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] leading-tight text-gray-300">{TROPHY_LABELS[record.category]}</span>
            <span className="text-right font-semibold tabular-nums">{record.valueLabel}{record.reported && <span className="block text-[9px] font-normal text-gray-400">reported</span>}{record.approximate && <span className="block text-[9px] font-normal text-gray-400">best found</span>}</span>
          </span>;
        })}
      </span>
      {records.some(record => record.provisional) && <span className="block border-t border-white/10 px-3 py-2 text-[10px] text-gray-400">XC rankings are provisional while flight calculations are incomplete.</span>}
    </span>
  </span>;
}
