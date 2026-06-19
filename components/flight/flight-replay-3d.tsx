"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { basemapStyleUrl } from "./map-style";
import { Card } from "@/components/ui/card";

type Sample = [number, number, number, number]; // lon, lat, alt, tSec

interface ReplayData {
  samples: Sample[];
  vario: number[];
  bounds: [number, number, number, number];
  durationS: number;
  altSource: "baro" | "gps";
  takeoffMs: number;
  offsetMin: number;
}

const GRAY = [130, 130, 130];
const GREEN = [90, 200, 110];
const RED = [225, 80, 80];
const lerp = (a: number[], b: number[], t: number) =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t));
/** Climb → green, sink → red, intensity by |vario| up to ~4 m/s. */
function varioColor(v: number): [number, number, number] {
  const x = Math.max(-4, Math.min(4, v)) / 4;
  return (x >= 0 ? lerp(GRAY, GREEN, x) : lerp(GRAY, RED, -x)) as [
    number,
    number,
    number,
  ];
}

function clock(tSec: number, takeoffMs: number, offsetMin: number) {
  const d = new Date(takeoffMs + tSec * 1000 + offsetMin * 60_000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}`;
}

export function FlightReplay3D({ flightId }: { flightId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dataRef = useRef<ReplayData | null>(null);
  const segmentsRef = useRef<
    { path: number[][]; t: number; color: [number, number, number] }[]
  >([]);
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [time, setTime] = useState(0);

  // Fetch the replay path.
  useEffect(() => {
    let active = true;
    fetch(`/api/flights/${flightId}/replay`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ReplayData) => {
        if (!active) return;
        dataRef.current = d;
        segmentsRef.current = d.samples.slice(0, -1).map((s, i) => ({
          path: [
            [s[0], s[1], s[2]],
            [d.samples[i + 1][0], d.samples[i + 1][1], d.samples[i + 1][2]],
          ],
          t: s[3],
          color: varioColor((d.vario[i] + d.vario[i + 1]) / 2),
        }));
        setData(d);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [flightId]);

  function positionAt(t: number): [number, number, number] {
    const s = dataRef.current!.samples;
    if (t <= 0) return [s[0][0], s[0][1], s[0][2]];
    for (let i = 1; i < s.length; i++) {
      if (s[i][3] >= t) {
        const a = s[i - 1];
        const b = s[i];
        const f = (t - a[3]) / (b[3] - a[3] || 1);
        return [
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f,
        ];
      }
    }
    const last = s[s.length - 1];
    return [last[0], last[1], last[2]];
  }

  function renderLayers(t: number) {
    const overlay = overlayRef.current;
    const d = dataRef.current;
    if (!overlay || !d) return;
    const pos = positionAt(t);
    type SegDatum = { path: number[][]; t: number; color: [number, number, number] };
    overlay.setProps({
      layers: [
        // The full 3D track, always visible, coloured by climb/sink.
        new PathLayer<SegDatum>({
          id: "track",
          data: segmentsRef.current,
          getPath: (s) => s.path as [number, number, number][],
          getColor: (s) => s.color,
          getWidth: 3,
          widthUnits: "pixels",
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
        }),
        // Glider marker at the current replay time.
        new ScatterplotLayer<[number, number, number]>({
          id: "glider",
          data: [pos],
          getPosition: (p) => p,
          getFillColor: [255, 180, 89],
          getLineColor: [20, 20, 20],
          lineWidthMinPixels: 1.5,
          stroked: true,
          getRadius: 7,
          radiusUnits: "pixels",
        }),
      ],
    });
  }

  // Build the map once we have data.
  useEffect(() => {
    if (!containerRef.current || !data) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleUrl(),
      pitch: 62,
      bearing: -20,
      maxPitch: 85,
      attributionControl: { compact: true },
    });
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    map.on("load", () => {
      // Keyless terrain (AWS terrarium DEM).
      map.addSource("dem", {
        type: "raster-dem",
        tiles: [
          "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
        ],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 13,
      });
      map.setTerrain({ source: "dem", exaggeration: 1.3 });

      const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      map.addControl(overlay);
      overlayRef.current = overlay;

      map.fitBounds(
        [
          [data.bounds[0], data.bounds[1]],
          [data.bounds[2], data.bounds[3]],
        ],
        { padding: 60, duration: 0 },
      );
      // fitBounds resets the camera tilt — re-apply pitch/bearing for the 3D view.
      map.setPitch(62);
      map.setBearing(-20);
      renderLayers(timeRef.current);
    });

    return () => {
      overlayRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Animation loop.
  useEffect(() => {
    if (!playing || !data) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let t = timeRef.current + dt * speed;
      if (t >= data.durationS) t = 0; // loop
      timeRef.current = t;
      setTime(t);
      renderLayers(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, data]);

  function scrub(t: number) {
    timeRef.current = t;
    setTime(t);
    renderLayers(t);
  }

  if (error) {
    return (
      <Card className="flex h-[460px] items-center justify-center text-gray-500">
        3D replay unavailable.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden">
        <div ref={containerRef} className="h-[460px] w-full" />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="h-9 w-16 rounded-md bg-amber font-condensed font-bold text-ink hover:bg-amber-strong"
            disabled={!data}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={data?.durationS ?? 100}
            step={1}
            value={Math.round(time)}
            onChange={(e) => scrub(Number(e.target.value))}
            className="flex-1 accent-amber"
          />
          <span className="w-20 text-right font-mono text-sm text-gray-600">
            {data ? clock(time, data.takeoffMs, data.offsetMin) : "--:--:--"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Speed</span>
          {[4, 8, 16, 32].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={
                "rounded px-2 py-0.5 " +
                (speed === s ? "bg-ink text-paper" : "bg-gray-100 text-gray-600")
              }
            >
              {s}×
            </button>
          ))}
          <span className="ml-auto">Drag to tilt &amp; rotate · green = climb, red = sink</span>
        </div>
      </Card>
    </div>
  );
}
