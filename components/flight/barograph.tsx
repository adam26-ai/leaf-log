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

function localClock(tOffsetS: number, takeoffMs: number, offsetMin: number) {
  const shifted = new Date(takeoffMs + tOffsetS * 1000 + offsetMin * 60_000);
  const hh = shifted.getUTCHours().toString().padStart(2, "0");
  const mm = shifted.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
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
  const altitudeScale = useMemo(
    () =>
      buildAltitudeScale(
        data.flatMap(({ alt, ground }) => (ground == null ? [alt] : [alt, ground])),
        units,
      ),
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
              <stop offset="0%" stopColor="#ffb459" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#ffb459" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="terrainFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#71835f" stopOpacity={0.62} />
              <stop offset="100%" stopColor="#71835f" stopOpacity={0.22} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#ededed" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => localClock(t, takeoffMs, offsetMin)}
            tick={{ fontSize: 12, fill: "#7a7a7a" }}
            minTickGap={48}
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
            stroke="#f59e2c"
            strokeWidth={2}
            fill="url(#baroFill)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="ground"
            name="Terrain"
            stroke="#596b49"
            strokeWidth={1.5}
            fill="url(#terrainFill)"
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, takeoffMs, offsetMin, altSource, altitudeUnit, altitudeScale],
  );

  const frac =
    activeTime != null && tMax > tMin
      ? Math.max(0, Math.min(1, (activeTime - tMin) / (tMax - tMin)))
      : null;

  return (
    <div className="relative h-[165px] w-full">
      {chart}
      {frac != null && (
        <div
          className="pointer-events-none absolute top-2 bottom-6 w-px border-l border-dashed border-ink"
          style={{
            left: `calc(${BAROGRAPH_PLOT_LEFT_INSET}px + (100% - ${BAROGRAPH_PLOT_LEFT_INSET + BAROGRAPH_PLOT_RIGHT_INSET}px) * ${frac})`,
          }}
        />
      )}
    </div>
  );
}
