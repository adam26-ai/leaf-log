"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { UnitSystem } from "@/lib/flights/format";
import { buildAltitudeScale } from "@/lib/flights/altitude-scale";
import {
  terrainElevationAt,
  type TerrainProfilePoint,
} from "@/lib/flights/terrain-profile";

const FEET_PER_METER = 3.280839895;

function localClock(
  tOffsetS: number,
  takeoffMs: number,
  offsetMin: number,
  includeSeconds = false,
) {
  const shifted = new Date(takeoffMs + tOffsetS * 1000 + offsetMin * 60_000);
  const hh = shifted.getUTCHours().toString().padStart(2, "0");
  const mm = shifted.getUTCMinutes().toString().padStart(2, "0");
  if (!includeSeconds) return `${hh}:${mm}`;
  const ss = shifted.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function clockAlignedTicks(
  tMin: number,
  tMax: number,
  takeoffMs: number,
  offsetMin: number,
) {
  const durationMin = Math.max(0, (tMax - tMin) / 60);
  const intervalMin = [5, 10, 15, 30, 60, 120].find(
    (candidate) => durationMin / candidate <= 5,
  ) ?? 240;
  const intervalMs = intervalMin * 60_000;
  const shiftedTakeoffMs = takeoffMs + offsetMin * 60_000;
  const startMs = shiftedTakeoffMs + tMin * 1000;
  const endMs = shiftedTakeoffMs + tMax * 1000;
  const endpointGapMs = intervalMs * 0.45;
  const ticks = [tMin];
  for (
    let boundary = Math.ceil(startMs / intervalMs) * intervalMs;
    boundary < endMs;
    boundary += intervalMs
  ) {
    const tick = (boundary - shiftedTakeoffMs) / 1000;
    if (boundary - startMs >= endpointGapMs && endMs - boundary >= endpointGapMs) {
      ticks.push(tick);
    }
  }
  if (tMax > tMin) ticks.push(tMax);
  return ticks;
}

function TimeAxisTick({
  x = 0,
  y = 0,
  payload,
  tMin,
  tMax,
  takeoffMs,
  offsetMin,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value: number | string };
  tMin: number;
  tMax: number;
  takeoffMs: number;
  offsetMin: number;
}) {
  const value = Number(payload?.value ?? 0);
  const first = Math.abs(value - tMin) < 0.5;
  const last = Math.abs(value - tMax) < 0.5;
  return (
    <text
      x={Number(x)}
      y={Number(y) + 14}
      fill="#7a7a7a"
      fontSize={12}
      textAnchor={first ? "start" : last ? "end" : "middle"}
    >
      {localClock(value, takeoffMs, offsetMin, first || last)}
    </text>
  );
}

// Shared by the timeline row so its rail uses exactly the same horizontal
// span as the Recharts X-axis. The wider left inset also houses Play/Pause.
const Y_AXIS_WIDTH = 44;
const CHART_LEFT_MARGIN = 28;
export const BAROGRAPH_PLOT_LEFT_INSET = Y_AXIS_WIDTH + CHART_LEFT_MARGIN;
export const BAROGRAPH_PLOT_RIGHT_INSET = 12;

export function Barograph({
  baro,
  terrain,
  takeoffMs,
  offsetMin,
  altSource,
  units,
  activeTime = null,
  onHoverTime,
}: {
  baro: [number, number][];
  terrain?: TerrainProfilePoint[];
  takeoffMs: number;
  offsetMin: number;
  altSource: "baro" | "gps";
  units: UnitSystem;
  /** Linked-cursor time (s from takeoff) — draws a reference line. */
  activeTime?: number | null;
  /** Report the hovered time for linked highlighting (not called on leave). */
  onHoverTime?: (t: number) => void;
}) {
  const data = useMemo(
    () =>
      baro.map(([t, alt]) => {
        const groundM = terrainElevationAt(terrain ?? [], t);
        return {
          t,
          alt: units === "imperial" ? alt * FEET_PER_METER : alt,
          ground:
            groundM == null
              ? undefined
              : units === "imperial"
                ? groundM * FEET_PER_METER
                : groundM,
        };
      }),
    [baro, terrain, units],
  );
  const altitudeUnit = units === "imperial" ? "ft" : "m";
  const tMin = data[0]?.t ?? 0;
  const tMax = data[data.length - 1]?.t ?? 1;
  const timeTicks = useMemo(
    () => clockAlignedTicks(tMin, tMax, takeoffMs, offsetMin),
    [tMin, tMax, takeoffMs, offsetMin],
  );
  const altitudeScale = useMemo(
    () => {
      const scale = buildAltitudeScale(
        data.flatMap(({ alt, ground }) => (ground == null ? [alt] : [alt, ground])),
        units,
      );
      const flightMax = Math.max(...data.map(({ alt }) => alt));
      const span = scale.domain[1] - scale.domain[0];
      const headroom = Math.max(span * 0.04, units === "imperial" ? 100 : 30);
      return {
        ...scale,
        domain: [
          scale.domain[0],
          Math.max(scale.domain[1], flightMax + headroom),
        ] as [number, number],
      };
    },
    [data, units],
  );

  // The chart doesn't depend on activeTime (the cursor is a lightweight overlay),
  // so memoize it — otherwise Recharts re-renders on every playback frame.
  const chart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%" minHeight={135}>
        <AreaChart
          data={data}
          margin={{
            top: 8,
            right: BAROGRAPH_PLOT_RIGHT_INSET,
            bottom: 4,
            left: CHART_LEFT_MARGIN,
          }}
          onMouseMove={(s) => {
            const label = (s as { activeLabel?: number | string })?.activeLabel;
            if (label != null) onHoverTime?.(Number(label));
          }}
        >
          <defs>
            <linearGradient id="baroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--replay-profile-fill)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--replay-profile-fill)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="terrainGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--replay-terrain-gradient)"
                stopOpacity="var(--replay-terrain-gradient-alpha)"
              />
              <stop
                offset="100%"
                stopColor="var(--replay-terrain-gradient)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#ededed" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={timeTicks}
            tick={(props) =>
              <TimeAxisTick
                {...props}
                tMin={tMin}
                tMax={tMax}
                takeoffMs={takeoffMs}
                offsetMin={offsetMin}
              />
            }
            minTickGap={48}
            interval={0}
          />
          <YAxis
            domain={altitudeScale.domain}
            ticks={altitudeScale.ticks}
            tick={{ fontSize: 12, fill: "#7a7a7a" }}
            width={Y_AXIS_WIDTH}
            tickFormatter={(v) => `${Math.round(Number(v)).toLocaleString()}${altitudeUnit}`}
          />
          <Tooltip
            labelFormatter={(t) => localClock(Number(t), takeoffMs, offsetMin)}
            formatter={(v, name) => [
              `${Math.round(Number(v)).toLocaleString()} ${altitudeUnit}`,
              String(name),
            ] as [string, string]}
            contentStyle={{ borderRadius: 6, borderColor: "#e0e0e0", fontSize: 13 }}
          />
          <Area
            type="monotone"
            dataKey="alt"
            name={altSource === "baro" ? "Baro altitude" : "GPS altitude"}
            stroke="none"
            fill="url(#baroFill)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="ground"
            name="Terrain"
            stroke="none"
            fill="var(--replay-terrain-fill)"
            fillOpacity="var(--replay-terrain-fill-alpha)"
            connectNulls
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="ground"
            name="Terrain gradient"
            tooltipType="none"
            stroke="none"
            fill="url(#terrainGradient)"
            connectNulls
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="ground"
            name="Terrain outline"
            tooltipType="none"
            stroke="var(--replay-terrain-line)"
            strokeWidth="var(--replay-terrain-line-width)"
            fill="none"
            connectNulls
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="alt"
            name="Flight profile outline"
            tooltipType="none"
            stroke="var(--replay-profile-line)"
            strokeWidth="var(--replay-profile-line-width)"
            fill="none"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, takeoffMs, offsetMin, altSource, altitudeUnit, altitudeScale, timeTicks, tMin, tMax],
  );

  const frac =
    activeTime != null && tMax > tMin
      ? Math.max(0, Math.min(1, (activeTime - tMin) / (tMax - tMin)))
      : null;

  return (
    <div className="relative h-[165px] w-full">
      <div
        className="pointer-events-none absolute top-[8px] bottom-[34px] bg-[var(--replay-profile-sky)]"
        style={{
          left: BAROGRAPH_PLOT_LEFT_INSET,
          right: BAROGRAPH_PLOT_RIGHT_INSET,
        }}
      />
      <div className="relative z-10 h-full">{chart}</div>
      {frac != null && (
        <div
          className="pointer-events-none absolute top-2 bottom-6 z-20 w-px border-l border-dashed border-ink"
          style={{
            left: `calc(${BAROGRAPH_PLOT_LEFT_INSET}px + (100% - ${BAROGRAPH_PLOT_LEFT_INSET + BAROGRAPH_PLOT_RIGHT_INSET}px) * ${frac})`,
          }}
        />
      )}
    </div>
  );
}
