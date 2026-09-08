import type { UnitSystem } from "@/lib/flights/format";

export type AltitudeScale = {
  domain: [number, number];
  ticks: number[];
};

function niceStepAtLeast(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function cleanTick(value: number) {
  return Number(value.toPrecision(12));
}

/**
 * Build a compact altitude axis with human-readable 1/2/5 × 10ⁿ intervals.
 *
 * Low flights include sea level when it adds only modest empty space. Flights
 * well above sea level retain their actual altitude range so the profile shape
 * remains easy to read.
 */
export function buildAltitudeScale(values: number[], units: UnitSystem): AltitudeScale {
  let dataMin = Number.POSITIVE_INFINITY;
  let dataMax = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    dataMin = Math.min(dataMin, value);
    dataMax = Math.max(dataMax, value);
  }
  if (!Number.isFinite(dataMin)) return { domain: [0, 1], ticks: [0, 1] };

  const dataSpan = dataMax - dataMin;
  const nearZeroDistance = units === "imperial" ? 500 : 200;
  const includeZero =
    dataMin >= 0 && dataMin <= Math.max(nearZeroDistance, dataSpan * 0.25);

  let domainMin = includeZero ? 0 : dataMin;
  let domainMax = dataMax;

  // Give a constant-altitude trace enough vertical room to render visibly.
  if (domainMax <= domainMin) {
    const padding = niceStepAtLeast(Math.max(Math.abs(domainMax) * 0.05, 1));
    domainMin = includeZero ? 0 : domainMin - padding;
    domainMax += padding;
  }

  const step = niceStepAtLeast((domainMax - domainMin) / 4);
  const firstTick = Math.ceil(domainMin / step) * step;
  const lastTick = Math.floor(domainMax / step) * step;
  const ticks: number[] = [];

  for (let tick = firstTick; tick <= lastTick + step * 1e-9; tick += step) {
    ticks.push(cleanTick(tick));
  }

  return {
    domain: [domainMin, domainMax],
    ticks: ticks.length > 0 ? ticks : [cleanTick(domainMin), cleanTick(domainMax)],
  };
}
