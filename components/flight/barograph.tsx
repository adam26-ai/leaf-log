"use client";

import { Fragment, useId, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { UnitSystem } from "@/lib/flights/format";
import { resolveUnits } from "@/lib/flights/units";
import { buildAltitudeScale } from "@/lib/flights/altitude-scale";
import { PROFILE_SHARED_COLORS, profileColor, profileSize, type ProfileState } from "./profile-palette";
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

export interface ProfileFlight {
  id: string;
  baro: [number, number | null][];
  terrain?: TerrainProfilePoint[];
  state: ProfileState;
}

export function Barograph({
  profiles,
  selectedFlightId,
  takeoffMs,
  offsetMin,
  units,
  activeTime = null,
  onScrubTime,
  timeDomain,
}: {
  profiles: ProfileFlight[];
  selectedFlightId?: string;
  timeDomain?: [number, number];
  takeoffMs: number;
  offsetMin: number;
  units: UnitSystem;
  /** Linked-cursor time (s from takeoff) — draws a reference line. */
  activeTime?: number | null;
  onScrubTime?: (t: number) => void;
}) {
  const chartId = useId().replace(/:/g, "");
  const altitudeUnit = resolveUnits(units).altitude;
  const profileData = useMemo(
    () => profiles.map((profile) => ({ ...profile, data:
      profile.baro.map(([t, alt]) => {
        const terrain = profile.terrain;
        const groundM = terrainElevationAt(terrain ?? [], t);
        return {
          t,
          alt: alt == null ? undefined : altitudeUnit === "ft" ? alt * FEET_PER_METER : alt,
          ground:
            groundM == null || alt == null
              ? undefined
              : altitudeUnit === "ft"
                ? groundM * FEET_PER_METER
                : groundM,
        };
      }),
    })).filter((profile) => profile.data.length > 0).sort((a, b) => Number(a.state.endsWith("Selected")) - Number(b.state.endsWith("Selected"))),
    [profiles, altitudeUnit],
  );
  const allData = useMemo(() => profileData.flatMap((profile) => profile.data).sort((a, b) => a.t - b.t), [profileData]);
  const data = useMemo(() => profileData.find((profile) => profile.id === selectedFlightId)?.data ?? [], [profileData, selectedFlightId]);
  const selectedStyle = profiles.find((profile) => profile.id === selectedFlightId)?.state ?? "ownSelected";
  const tMin = timeDomain?.[0] ?? allData[0]?.t ?? 0;
  const tMax = timeDomain?.[1] ?? allData[allData.length - 1]?.t ?? 1;
  const timeTicks = useMemo(
    () => clockAlignedTicks(tMin, tMax, takeoffMs, offsetMin),
    [tMin, tMax, takeoffMs, offsetMin],
  );
  const altitudeScale = useMemo(
    () => {
      const scale = buildAltitudeScale(
        allData.flatMap(({ alt, ground }) => [alt, ground].filter((v): v is number => v != null)),
        altitudeUnit === "ft" ? "imperial" : "metric",
      );
      const flightMax = allData.reduce((maximum, { alt }) => Math.max(maximum, alt ?? -Infinity), -Infinity);
      const span = scale.domain[1] - scale.domain[0];
      const headroom = Math.max(span * 0.04, altitudeUnit === "ft" ? 100 : 30);
      return {
        ...scale,
        domain: [
          scale.domain[0],
          Math.max(scale.domain[1], flightMax + headroom),
        ] as [number, number],
      };
    },
    [allData, altitudeUnit],
  );

  // The chart doesn't depend on activeTime (the cursor is a lightweight overlay),
  // so memoize it — otherwise Recharts re-renders on every playback frame.
  const chart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%" minHeight={135}>
        <AreaChart
          accessibilityLayer={false}
          data={allData}
          margin={{
            top: 8,
            right: BAROGRAPH_PLOT_RIGHT_INSET,
            bottom: 4,
            left: CHART_LEFT_MARGIN,
          }}
        >
          <defs>
            {profileData.map(({ id, state }, index) => <Fragment key={id}>
              <linearGradient id={`${chartId}-profile-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={profileColor(state, "profileFill")} stopOpacity={profileSize(state, "profileFillAlpha")} />
                <stop offset="100%" stopColor={profileColor(state, "profileFill")} stopOpacity={`calc(${profileSize(state, "profileFillAlpha")} * 0.057)`} />
              </linearGradient>
              <linearGradient id={`${chartId}-terrain-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={profileColor(state, "terrainGradient")} stopOpacity={profileSize(state, "terrainGradientAlpha")} />
                <stop offset="100%" stopColor={profileColor(state, "terrainGradient")} stopOpacity={0} />
              </linearGradient>
            </Fragment>)}
          </defs>
          <CartesianGrid stroke={`var(--replay-profile-grid, ${PROFILE_SHARED_COLORS.profileGrid})`} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[tMin, tMax]}
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
            interval="preserveStartEnd"
          />
          <YAxis
            domain={altitudeScale.domain}
            ticks={altitudeScale.ticks}
            tick={{ fontSize: 12, fill: "#7a7a7a" }}
            width={Y_AXIS_WIDTH}
            tickFormatter={(v) => `${Math.round(Number(v)).toLocaleString()}${altitudeUnit}`}
          />
          {profileData.map(({ id, state, data }, index) => {
            const zIndex = state.endsWith("Selected") ? 200 : 100;
            return <Fragment key={id}>
              <Area zIndex={zIndex} data={data} type="monotone" dataKey="alt" name="Flight altitude" stroke="none" fill={`url(#${chartId}-profile-${index})`} isAnimationActive={false} />
              <Area zIndex={zIndex} data={data} type="monotone" dataKey="ground" name="Terrain" stroke="none" fill={profileColor(state, "terrainFill")} fillOpacity={profileSize(state, "terrainFillAlpha")} isAnimationActive={false} />
              <Area zIndex={zIndex} data={data} type="monotone" dataKey="ground" name="Terrain gradient" stroke="none" fill={`url(#${chartId}-terrain-${index})`} isAnimationActive={false} />
              <Area zIndex={zIndex} data={data} type="monotone" dataKey="ground" name="Terrain outline" stroke={profileColor(state, "terrainLine")} strokeWidth={profileSize(state, "terrainLine")} fill="none" isAnimationActive={false} />
              <Area zIndex={zIndex} className={`profile-flight-${id} profile-state-${state}`} data={data} type="monotone" dataKey="alt" name="Flight profile outline" stroke={profileColor(state, "profileLine")} strokeWidth={profileSize(state, "profileLine")} fill="none" isAnimationActive={false} />
            </Fragment>;
          })}
        </AreaChart>
      </ResponsiveContainer>
    ),
    [allData, profileData, chartId, takeoffMs, offsetMin, altitudeUnit, altitudeScale, timeTicks, tMin, tMax],
  );

  const frac =
    activeTime != null && tMax > tMin
      ? Math.max(0, Math.min(1, (activeTime - tMin) / (tMax - tMin)))
      : null;
  const activeValues = useMemo(() => {
    if (activeTime == null || data.length === 0 || activeTime < data[0].t || activeTime > data[data.length - 1].t) return null;
    let next = data.findIndex((point) => point.t >= activeTime);
    if (next < 0) next = data.length - 1;
    const previous = Math.max(0, next - 1);
    const a = data[previous];
    const b = data[next];
    const portion = b.t === a.t ? 0 : (activeTime - a.t) / (b.t - a.t);
    const interpolate = (first: number | undefined, second: number | undefined) =>
      first == null || second == null ? undefined : first + (second - first) * portion;
    return { alt: interpolate(a.alt, b.alt), ground: interpolate(a.ground, b.ground) };
  }, [activeTime, data]);
  const verticalPosition = (value: number) => {
    const [minimum, maximum] = altitudeScale.domain;
    return 8 + (1 - (value - minimum) / (maximum - minimum)) * 123;
  };
  const labelSide = frac != null && frac > 0.72 ? "-translate-x-full -ml-2" : "ml-2";

  function scrubFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!onScrubTime) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const plotWidth = bounds.width - BAROGRAPH_PLOT_LEFT_INSET - BAROGRAPH_PLOT_RIGHT_INSET;
    if (plotWidth <= 0) return;
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left - BAROGRAPH_PLOT_LEFT_INSET) / plotWidth),
    );
    onScrubTime(tMin + fraction * (tMax - tMin));
  }

  return (
    <div
      className="relative h-[165px] w-full cursor-ew-resize select-none [&_.recharts-wrapper]:outline-none [&_.recharts-wrapper_*]:outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubFromPointer(event);
      }}
      onPointerMove={(event) => {
        if ((event.buttons & 1) !== 0) scrubFromPointer(event);
      }}
    >
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
      {frac != null && activeValues?.alt != null && (
        <div
          className="pointer-events-none absolute z-30 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--replay-profile-line)] shadow-sm"
          style={{
            backgroundColor: profileColor(selectedStyle, "profileLine"),
            left: `calc(${BAROGRAPH_PLOT_LEFT_INSET}px + (100% - ${BAROGRAPH_PLOT_LEFT_INSET + BAROGRAPH_PLOT_RIGHT_INSET}px) * ${frac})`,
            top: verticalPosition(activeValues.alt),
          }}
        >
          {activeValues.ground != null && (
            <span className={`absolute left-full bottom-full mb-0.5 whitespace-nowrap rounded bg-ink/35 px-1.5 py-0.5 text-[10px] font-bold text-white ${labelSide}`}>
              AGL {Math.round(activeValues.alt - activeValues.ground).toLocaleString()} {altitudeUnit}
            </span>
          )}
        </div>
      )}
      {frac != null && activeValues?.ground != null && (
        <div
          className="pointer-events-none absolute z-30 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--replay-terrain-line)] shadow-sm"
          style={{
            backgroundColor: profileColor(selectedStyle, "terrainLine"),
            left: `calc(${BAROGRAPH_PLOT_LEFT_INSET}px + (100% - ${BAROGRAPH_PLOT_LEFT_INSET + BAROGRAPH_PLOT_RIGHT_INSET}px) * ${frac})`,
            top: verticalPosition(activeValues.ground),
          }}
        >
          <span className={`absolute left-full top-full mt-0.5 whitespace-nowrap rounded bg-ink/35 px-1.5 py-0.5 text-[10px] font-bold text-white ${labelSide}`}>
            Terrain {Math.round(activeValues.ground).toLocaleString()} {altitudeUnit}
          </span>
        </div>
      )}
    </div>
  );
}
