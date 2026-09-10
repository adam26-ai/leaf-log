import type { Fix } from "./types";
import { playbackAltitude } from "./altitude";

const WINDOW_S = 4;

/** One centred four-second altitude difference, before replay downsampling.
 * Shorten at segment ends; never bridge missing altitudes or recording gaps.
 * Endpoint interpolation keeps irregular fix intervals from widening the window.
 * Sparse recordings retain their native resolution; interpolation cannot recover
 * peaks shorter than the recorder's sample interval.
 */
export function calculatedVario(fixes: Fix[], source: "baro" | "gps", offset: number | null): number[] {
  const altitudes = fixes.map(fix => fix.valid ? playbackAltitude(fix, source, offset) : null);
  const intervals = fixes.slice(1).map((fix, index) => fix.t - fixes[index].t)
    .filter(dt => dt > 0).sort((a, b) => a - b);
  const gapS = Math.max(WINDOW_S, (intervals[Math.floor(intervals.length / 2)] ?? 1) * 3);
  const result = fixes.map(() => 0);
  let start = 0;
  while (start < fixes.length) {
    if (altitudes[start] == null) { start++; continue; }
    let end = start;
    while (end + 1 < fixes.length && altitudes[end + 1] != null &&
      fixes[end + 1].t > fixes[end].t && fixes[end + 1].t - fixes[end].t <= gapS) end++;

    const altitudeAt = (time: number) => {
      let low = start, high = end;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (fixes[middle].t < time) low = middle + 1;
        else high = middle;
      }
      if (low === start || fixes[low].t === time) return altitudes[low]!;
      const before = low - 1;
      const fraction = (time - fixes[before].t) / (fixes[low].t - fixes[before].t);
      return altitudes[before]! + (altitudes[low]! - altitudes[before]!) * fraction;
    };
    for (let index = start; index <= end; index++) {
      const from = Math.max(fixes[start].t, fixes[index].t - WINDOW_S / 2);
      const to = Math.min(fixes[end].t, fixes[index].t + WINDOW_S / 2);
      result[index] = to > from ? (altitudeAt(to) - altitudeAt(from)) / (to - from) : 0;
    }
    start = end + 1;
  }
  return result;
}
