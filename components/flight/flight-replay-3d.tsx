"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, IconLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import {
  LightingEffect,
  AmbientLight,
  DirectionalLight,
} from "@deck.gl/core";
import { SphereGeometry } from "@luma.gl/engine";
import { styleFor, isImagery, type BasemapId } from "./basemaps";
import { isPinned, photoUrl, type FlightPhoto } from "./photos";
import { Card } from "@/components/ui/card";

// Camera icon for photo pins (rendered as a billboarded deck.gl IconLayer).
const CAMERA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="14" fill="#272727" stroke="#ffffff" stroke-width="2.5"/>' +
  '<rect x="14.2" y="11.8" width="5.6" height="3" rx="1" fill="#ffffff"/>' +
  '<rect x="9.5" y="13.8" width="15" height="10.7" rx="2.2" fill="#ffffff"/>' +
  '<circle cx="17" cy="19.2" r="3.4" fill="#272727"/>' +
  '<circle cx="17" cy="19.2" r="1.6" fill="#ffffff"/></svg>';
const CAMERA_ICON = `data:image/svg+xml,${encodeURIComponent(CAMERA_SVG)}`;

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

export function FlightReplay3D({
  flightId,
  basemap = "monochrome",
  time,
  cameraFollow = true,
  photos = [],
  onPhotoHover,
  onPhotoOpen,
}: {
  flightId: string;
  basemap?: BasemapId;
  /** Shared replay time (s from takeoff) — drives the glider position. */
  time: number;
  /** Keep the camera centred on the glider (vs a free/fixed camera). */
  cameraFollow?: boolean;
  /** Geotagged photos to pin on the 3D track. */
  photos?: FlightPhoto[];
  /** Hovering a photo pin moves the scrubber to its time-from-takeoff. */
  onPhotoHover?: (tSec: number) => void;
  /** Clicking a photo pin opens it (lightbox) and moves the scrubber. */
  onPhotoOpen?: (photoId: string, tSec: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dataRef = useRef<ReplayData | null>(null);
  const segmentsRef = useRef<
    { path: number[][]; t: number; color: [number, number, number] }[]
  >([]);
  const timeRef = useRef(time);
  const basemapRef = useRef(basemap);
  const cameraFollowRef = useRef(cameraFollow);
  const didInitBasemap = useRef(false);
  // Vertical offset (m) that snaps takeoff altitude to the terrain (corrects the
  // IGC baro/GPS reference vs the DEM's sea-level reference).
  const offsetRef = useRef(0);
  const anchoredRef = useRef(false);
  const anchorTimerRef = useRef<number | null>(null);
  const photosRef = useRef(photos);
  const onPhotoHoverRef = useRef(onPhotoHover);
  const onPhotoOpenRef = useRef(onPhotoOpen);
  useEffect(() => {
    photosRef.current = photos;
    onPhotoHoverRef.current = onPhotoHover;
    onPhotoOpenRef.current = onPhotoOpen;
  });

  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState(false);
  // Hovered photo thumbnail preview (screen position from deck picking).
  const [hoverPhoto, setHoverPhoto] = useState<{ x: number; y: number; id: string } | null>(null);

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

  // Map a raw IGC altitude to the scene's vertical space (takeoff anchor offset,
  // then terrain exaggeration so the track stays consistent with the mesh).
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

  // Chase camera: make the glider itself (at its altitude) the camera's look-at
  // point, so the distance (zoom), tilt (pitch) and azimuth (bearing) all stay
  // constant as it flies — the world moves under a fixed sphere. jumpTo only
  // updates the centre + its elevation, leaving zoom/pitch/bearing as the user
  // set them (drag still rotates/tilts, scroll still changes distance). Needs
  // setCenterClampedToGround(false) so the centre can sit above the terrain.
  function centerOnGlider(t: number) {
    const map = mapRef.current;
    if (!map || !dataRef.current) return;
    if (map.getCenterClampedToGround()) map.setCenterClampedToGround(false);
    const p = positionAt(t);
    map.jumpTo({ center: [p[0], p[1]], elevation: zOf(p[2]) });
  }

  function renderLayers(t: number) {
    const overlay = overlayRef.current;
    const d = dataRef.current;
    if (!overlay || !d) return;
    const pos = positionAt(t);
    type SegDatum = { path: number[][]; t: number; color: [number, number, number] };
    type PhotoIcon = { id: string; tSec: number; position: [number, number, number] };
    // Place each photo at its position on the track (at altitude).
    const photoIcons: PhotoIcon[] = photosRef.current.filter(isPinned).map((ph) => {
      if (ph.tSec != null) {
        const q = positionAt(ph.tSec);
        return { id: ph.id, tSec: ph.tSec, position: [q[0], q[1], zOf(q[2])] };
      }
      return {
        id: ph.id,
        tSec: -1,
        position: [ph.lon as number, ph.lat as number, zOf(ph.altM ?? 0)],
      };
    });
    overlay.setProps({
      layers: [
        // The full 3D track, always visible, coloured by climb/sink.
        new PathLayer<SegDatum>({
          id: "track",
          data: segmentsRef.current,
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
          // segmentsRef is a stable reference, so without this deck.gl caches the
          // path geometry and the track wouldn't move when the terrain anchor
          // changes the altitude offset — leaving the glider off the line.
          updateTriggers: { getPath: offsetRef.current },
        }),
        // Photo pins (camera icons) at their position on the track.
        new IconLayer<PhotoIcon>({
          id: "photo-pins",
          data: photoIcons,
          pickable: true,
          billboard: true,
          getIcon: () => ({ url: CAMERA_ICON, width: 68, height: 68, anchorX: 34, anchorY: 34 }),
          getPosition: (d) => d.position,
          getSize: 30,
          sizeUnits: "pixels",
          updateTriggers: { getPosition: offsetRef.current },
          onHover: (info) => {
            const o = info.object as PhotoIcon | null;
            if (o) {
              if (o.tSec >= 0) onPhotoHoverRef.current?.(o.tSec);
              setHoverPhoto({ x: info.x, y: info.y, id: o.id });
            } else {
              setHoverPhoto(null);
            }
          },
          onClick: (info) => {
            const o = info.object as PhotoIcon | null;
            if (o) onPhotoOpenRef.current?.(o.id, o.tSec >= 0 ? o.tSec : null);
            return true;
          },
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

  // (Re)apply our DEM terrain + hillshade + sky. Needed on first load and after
  // every basemap setStyle (which resets terrain and wipes custom layers).
  function setupTerrain(map: maplibregl.Map) {
    if (!map.getSource("dem")) {
      map.addSource("dem", {
        type: "raster-dem",
        tiles: [
          "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
        ],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 13,
      });
    }
    map.setTerrain({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });

    // Hillshade helps slopes read on a pale basemap; satellite/hybrid already
    // show natural shading, so skip it there.
    if (!isImagery(basemapRef.current) && !map.getLayer("hillshade")) {
      const firstSymbol = map
        .getStyle()
        .layers?.find((l) => l.type === "symbol")?.id;
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
  }

  // Build the map once we have data.
  useEffect(() => {
    if (!containerRef.current || !data) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(basemapRef.current),
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
    map.on("move", () => renderLayers(timeRef.current));

    map.on("load", () => {
      setupTerrain(map);

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
      // Entering 3D mid-flight with follow on: centre on the glider (a fresh
      // load sits at takeoff t=0, where the fitBounds overview is preferred).
      if (cameraFollowRef.current && timeRef.current > 0) {
        centerOnGlider(timeRef.current);
      }

      // Once terrain tiles are loaded, snap the takeoff to the ground so the
      // whole track sits correctly on the terrain (corrects baro/GPS-vs-DEM
      // reference). Retries on each idle until the DEM is queryable.
      const anchorToTerrain = () => {
        if (anchoredRef.current || !dataRef.current) return;
        const s0 = dataRef.current.samples[0];
        // queryTerrainElevation returns the EXAGGERATED elevation — divide it
        // back out to recover the raw ground elevation. It returns 0 (not null)
        // before the DEM tile at this point is cached, so treat 0/non-finite as
        // "not ready yet" and retry on the next idle — otherwise we'd anchor to a
        // bogus 0 m ground and sink the whole track underground.
        let exaggerated: number | null = null;
        try {
          exaggerated = map.queryTerrainElevation([s0[0], s0[1]]);
        } catch {
          exaggerated = null;
        }
        if (exaggerated == null || !Number.isFinite(exaggerated) || exaggerated === 0) {
          return;
        }
        const rawGround = exaggerated / TERRAIN_EXAGGERATION;
        const off = rawGround - s0[2];
        if (Math.abs(off) <= 400) offsetRef.current = off; // sanity clamp
        anchoredRef.current = true;
        renderLayers(timeRef.current);
      };
      map.on("idle", anchorToTerrain);
      anchorToTerrain();
      // 'idle' can fire before the DEM at takeoff is queryable, so also poll for
      // a few seconds until the elevation reads (then stop).
      let tries = 0;
      anchorTimerRef.current = window.setInterval(() => {
        if (anchoredRef.current || tries++ > 40) {
          if (anchorTimerRef.current) window.clearInterval(anchorTimerRef.current);
          anchorTimerRef.current = null;
          return;
        }
        anchorToTerrain();
      }, 250);
    });

    return () => {
      if (anchorTimerRef.current) window.clearInterval(anchorTimerRef.current);
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Swap basemap style, then re-apply terrain + re-render the deck overlay
  // (setStyle preserves the camera but resets terrain and custom layers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!didInitBasemap.current) {
      didInitBasemap.current = true;
      return; // initial style already set at build time
    }
    const reAdd = () => {
      setupTerrain(map);
      renderLayers(timeRef.current);
    };
    const swap = () => {
      map.setStyle(styleFor(basemap));
      map.once("style.load", reAdd);
    };
    if (map.isStyleLoaded()) swap();
    else map.once("load", swap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // Following looks at the glider above the terrain (unclamped centre); fixed
  // returns the centre to the ground for normal map interaction.
  useEffect(() => {
    mapRef.current?.setCenterClampedToGround(!cameraFollow);
  }, [cameraFollow]);

  // Render the glider at the shared time; follow it with the camera if enabled.
  useEffect(() => {
    timeRef.current = time;
    cameraFollowRef.current = cameraFollow;
    if (cameraFollow) centerOnGlider(time);
    renderLayers(time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, cameraFollow]);

  // Re-render the photo pins when the set changes.
  useEffect(() => {
    if (overlayRef.current) renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  if (error) {
    return (
      <Card className="flex h-[460px] items-center justify-center text-gray-500">
        3D replay unavailable.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative h-[460px] w-full">
        <div ref={containerRef} className="absolute inset-0" />
        {hoverPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(flightId, hoverPhoto.id, "thumb")}
            alt=""
            className="pointer-events-none absolute z-10 h-[120px] w-[120px] rounded object-cover shadow-lg ring-1 ring-black/20"
            style={{
              left: Math.min(hoverPhoto.x + 16, 9999),
              top: Math.max(hoverPhoto.y - 132, 8),
            }}
          />
        )}
      </div>
    </Card>
  );
}
