"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function localClock(tOffsetS: number, takeoffMs: number, offsetMin: number) {
  const shifted = new Date(takeoffMs + tOffsetS * 1000 + offsetMin * 60_000);
  const hh = shifted.getUTCHours().toString().padStart(2, "0");
  const mm = shifted.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function Barograph({
  baro,
  takeoffMs,
  offsetMin,
  altSource,
}: {
  baro: [number, number][];
  takeoffMs: number;
  offsetMin: number;
  altSource: "baro" | "gps";
}) {
  const data = baro.map(([t, alt]) => ({ t, alt }));

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%" minHeight={180}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="baroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffb459" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#ffb459" stopOpacity={0.02} />
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
            tick={{ fontSize: 12, fill: "#7a7a7a" }}
            width={44}
            tickFormatter={(v) => `${v}m`}
          />
          <Tooltip
            labelFormatter={(t) => localClock(Number(t), takeoffMs, offsetMin)}
            formatter={(v) => [`${v} m`, altSource === "baro" ? "Baro alt" : "GPS alt"] as [string, string]}
            contentStyle={{ borderRadius: 6, borderColor: "#e0e0e0", fontSize: 13 }}
          />
          <Area
            type="monotone"
            dataKey="alt"
            stroke="#f59e2c"
            strokeWidth={2}
            fill="url(#baroFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
