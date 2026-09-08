"use client";
import { Clock, Cloud, Mountain, Waypoints, Triangle, TriangleRight, Trophy, Plus } from "lucide-react";
import { TROPHY_LABELS, type FlightTrophy } from "@/lib/flights/trophies";
import { formatAltitude, formatDistance, formatDuration } from "@/lib/flights/format";
import { useUnits } from "@/lib/flights/use-units";

const icons = { duration: Clock, altitude: Cloud, "launch-gain": Mountain, open: Waypoints, "fai-triangle": Triangle, "free-triangle": TriangleRight };
const medals = { 1: "Gold", 2: "Silver", 3: "Bronze" };
const colors = { 1: "bg-[#f5cd57] text-[#563b00]", 2: "bg-[#dce2e8] text-[#394452]", 3: "bg-[#c99362] text-[#40240e]" };

export function TrophyPill({ trophies }: { trophies: FlightTrophy[] }) {
  const [units] = useUnits();
  if (!trophies.length) return null;
  const first = trophies[0], multiple = trophies.length > 1;
  const Icon = icons[first.category];
  const descriptions = trophies.map((t) => `${medals[t.rank]} — ${TROPHY_LABELS[t.category]}: ${t.category === "duration" ? formatDuration(t.value) : t.category === "altitude" || t.category === "launch-gain" ? formatAltitude(t.value, units) : formatDistance(t.value, units)}${t.approximate ? " (best found)" : ""}`);
  return <span tabIndex={0} aria-label={descriptions.join("; ")} className="group/trophy relative inline-flex justify-center outline-none">
    <span className={`inline-flex h-6 items-center gap-1 rounded-full border border-black/20 px-1.5 ${multiple ? "bg-[#454545] text-white" : colors[first.rank]}`}>
      <Trophy className="h-3.5 w-3.5" />{multiple ? <Plus className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
    </span>
    <span role="tooltip" className="pointer-events-none absolute right-0 bottom-full z-40 mb-2 hidden w-60 max-w-[80vw] rounded-lg bg-gray-900 p-3 text-left text-xs font-normal text-white shadow-lg group-hover/trophy:block group-focus/trophy:block">
      <span className="mb-1 block font-bold">Personal all-time trophies</span>
      {descriptions.map((description) => <span className="block py-0.5" key={description}>{description}</span>)}
    </span>
  </span>;
}
