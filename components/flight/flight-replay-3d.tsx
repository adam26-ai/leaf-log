"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import {
  LightingEffect,
  AmbientLight,
  DirectionalLight,
} from "@deck.gl/core";
import { SphereGeometry } from "@luma.gl/engine";
import { basemapStyleUrl } from "./map-style";
import { Card } from "@/components/ui/card";

// A light so the 3D glider sphere is actually shaded (not a flat disc).
const lightingEffect = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
  sun: new DirectionalLight({
    color: [255, 255, 255],
    intensity: 2.0,
    direction: [-1, -3, -1],
  }),
});

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

// True vertical scale (1.0): the track's real altitude and the real terrain
// elevation share one reference, so the flight path sits correctly on/above the
// ground. Exaggerating terrain would also inflate the track's height-above-ground
// by the same factor, so it must stay applied to BOTH if ever changed.
const TERRAIN_EXAGGERATION = 1.0;

// A unit sphere for the 3D glider marker (sized in metres via sizeScale).
const GLIDER_MESH = new SphereGeometry({ radius: 1, nlat: 18, nlong: 36 });

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

export function FlightReplay3D({
  flightId,
  externalTime = null,
  onHoverTime,
}: {
  flightId: string;
  /** Linked-cursor time (s) from the barograph — overrides the glider position. */
  externalTime?: number | null;
  /** Report the hovered time (or null) when pointing at the 3D track. */
  onHoverTime?: (t: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dataRef = useRef<ReplayData | null>(null);
  const segmentsRef = useRef<
    { path: number[][]; t: number; color: [number, number, number] }[]
  >([]);
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const externalTimeRef = useRef<number | null>(externalTime);
  const onHoverRef = useRef(onHoverTime);
  useEffect(() => {
    onHoverRef.current = onHoverTime;
  });
  // Vertical offset (m) that snaps takeoff altitude to the terrain (corrects the
  // IGC baro/GPS reference vs the DEM's sea-level reference).
  const offsetRef = useRef(0);
  const anchoredRef = useRef(false);

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

  // Map a raw IGC altitude to the scene's vertical space: apply the takeoff
  // anchor offset, then the terrain exaggeration so the track stays consistent
  // with the (exaggerated) terrain mesh.
  function zOf(alt: number) {
    return (alt + offsetRef.current) * TERRAIN_EXAGGERATION;
  }

  // World-size (metres) for the glider sphere that renders at a roughly constant
  // ~9px radius regardless of zoom (a world-sized mesh has no pixel-size prop).
  function gliderSizeMeters() {
    const map = mapRef.current;
    if (!map) return 40;
    const lat = map.getCenter().lat;
    const metersPerPixel =
      (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) /
      (512 * 2 ** map.getZoom());
    return Math.max(6, 9 * metersPerPixel);
  }

  function renderLayers(t: number) {
    const overlay = overlayRef.current;
    const d = dataRef.current;
    if (!overlay || !d) return;
    // A linked cursor from the barograph (externalTime) wins over playback time.
    const pos = positionAt(externalTimeRef.current ?? t);
    type SegDatum = { path: number[][]; t: number; color: [number, number, number] };
    overlay.setProps({
      layers: [
        // The full 3D track, always visible, coloured by climb/sink.
        new PathLayer<SegDatum>({
          id: "track",
          data: segmentsRef.current,
          pickable: true,
          onHover: (info) =>
            onHoverRef.current?.(
              (info.object as SegDatum | null)?.t ?? null,
            ),
          getPath: (s) =>
            s.path.map((p) => [p[0], p[1], zOf(p[2])]) as [
              number,
              number,
              number,
            ][],
          getColor: (s) => s.color,
          getWidth: 4,
          widthUnits: "pixels",
          widthMinPixels: 3,
          // Face the camera so the line keeps its width when the view is tilted
          // (a flat ribbon goes edge-on and disappears at high pitch).
          billboard: true,
          capRounded: true,
          jointRounded: true,
        }),
        // 3D glider marker (a shaded sphere) at the current replay time.
        new SimpleMeshLayer<[number, number, number]>({
          id: "glider",
          data: [pos],
          mesh: GLIDER_MESH,
          getPosition: (p) => [p[0], p[1], zOf(p[2])],
          getColor: [255, 180, 89],
          sizeScale: gliderSizeMeters(),
          material: {
            ambient: 0.5,
            diffuse: 0.6,
            shininess: 32,
            specularColor: [255, 255, 255],
          },
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
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    // Keep the glider sphere a constant on-screen size as the user zooms/pans.
    map.on("move", () => renderLayers(externalTimeRef.current ?? timeRef.current));

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
      map.setTerrain({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });

      // Hillshade so slopes read against the pale basemap (the 3D mesh alone is
      // hard to see on positron). Insert below labels.
      const firstSymbol = map
        .getStyle()
        .layers?.find((l) => l.type === "symbol")?.id;
      if (!map.getLayer("hillshade")) {
        map.addLayer(
          {
            id: "hillshade",
            type: "hillshade",
            source: "dem",
            paint: {
              "hillshade-exaggeration": 0.6,
              "hillshade-shadow-color": "#4a4a4a",
              "hillshade-highlight-color": "#ffffff",
            },
          },
          firstSymbol,
        );
      }

      // Sky for a sense of horizon/atmosphere in the tilted 3D view.
      try {
        map.setSky({
          "sky-color": "#9ec3e6",
          "horizon-color": "#e8eef5",
          "fog-color": "#ffffff",
          "horizon-fog-blend": 0.5,
          "fog-ground-blend": 0.2,
        });
      } catch {
        /* older style: sky unsupported — ignore */
      }

      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
        effects: [lightingEffect],
      });
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

      // Once terrain tiles are loaded, snap the takeoff to the ground so the
      // whole track sits correctly on the terrain (corrects baro/GPS-vs-DEM
      // reference). Retries on each idle until the DEM is queryable.
      const anchorToTerrain = () => {
        if (anchoredRef.current || !dataRef.current) return;
        const s0 = dataRef.current.samples[0];
        // queryTerrainElevation returns the EXAGGERATED elevation — divide it
        // back out to recover the raw ground elevation.
        let exaggerated: number | null = null;
        try {
          exaggerated = map.queryTerrainElevation([s0[0], s0[1]]);
        } catch {
          exaggerated = null;
        }
        if (exaggerated == null) return;
        const rawGround = exaggerated / TERRAIN_EXAGGERATION;
        const off = rawGround - s0[2];
        if (Math.abs(off) <= 400) offsetRef.current = off; // sanity clamp
        anchoredRef.current = true;
        renderLayers(timeRef.current);
      };
      map.on("idle", anchorToTerrain);
      anchorToTerrain();
    });

    return () => {
      overlayRef.current = null;
      mapRef.current = null;
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

  // Linked cursor from the barograph: move the glider to the hovered time.
  useEffect(() => {
    externalTimeRef.current = externalTime;
    renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTime]);

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
            value={Math.round(externalTime ?? time)}
            onChange={(e) => scrub(Number(e.target.value))}
            className="flex-1 accent-amber"
          />
          <span className="w-20 text-right font-mono text-sm text-gray-600">
            {data
              ? clock(externalTime ?? time, data.takeoffMs, data.offsetMin)
              : "--:--:--"}
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
