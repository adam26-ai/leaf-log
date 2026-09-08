import { readXcScore } from "@/lib/igc/xc-types";

export type TrophyCategory = "duration" | "altitude" | "launch-gain" | "open" | "fai-triangle" | "free-triangle";
export interface FlightTrophy { category: TrophyCategory; rank: 1 | 2 | 3; value: number; approximate: boolean }
export interface TrophyFlight {
  id: string; status: string; durationS: number | null; maxAltM: number | null;
  launchAltM?: number | null; xcScore: unknown;
}
export const TROPHY_LABELS: Record<TrophyCategory, string> = {
  duration: "Longest duration", altitude: "Highest altitude (MSL)", "launch-gain": "Highest gain from launch",
  open: "Open distance", "fai-triangle": "FAI triangle", "free-triangle": "Free triangle",
};

/** Personal all-time competition ranks: tied places share medals, ranks skip. */
export function flightTrophies(flights: TrophyFlight[]): Record<string, FlightTrophy[]> {
  const result: Record<string, FlightTrophy[]> = {};
  for (const category of Object.keys(TROPHY_LABELS) as TrophyCategory[]) {
    const entries = flights.flatMap((f) => {
      if (f.status !== "ready") return [];
      let value: number | null | undefined, approximate = false;
      if (category === "duration") value = f.durationS;
      else if (category === "altitude") value = f.maxAltM;
      else if (category === "launch-gain") value = f.maxAltM != null && f.launchAltM != null ? f.maxAltM - f.launchAltM : null;
      else {
        const route = readXcScore(f.xcScore)?.candidates?.filter((c) => c.shape === category && Number.isFinite(c.distanceM)).sort((a, b) => b.distanceM - a.distanceM)[0];
        value = route?.distanceM; approximate = route ? !route.optimal : false;
      }
      return value != null && Number.isFinite(value) && (category === "altitude" || value > 0) ? [{ id: f.id, value, approximate }] : [];
    }).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    let rank = 0;
    entries.forEach((entry, index) => {
      if (index === 0 || entry.value !== entries[index - 1].value) rank = index + 1;
      if (rank > 3) return;
      (result[entry.id] ??= []).push({ category, rank: rank as 1 | 2 | 3, value: entry.value, approximate: entry.approximate });
    });
  }
  return result;
}
