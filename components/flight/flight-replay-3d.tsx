"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, IconLayer, LineLayer, TextLayer } from "@deck.gl/layers";
import { styleFor, isImagery, type BasemapId } from "./basemaps";
import { isPinned, photoUrl, type FlightPhoto } from "./photos";
import { Card } from "@/components/ui/card";
import { headingAt, type Sample } from "@/lib/igc/interpolate";
import { formatAltitude, type UnitSystem } from "@/lib/flights/format";

// Camera icon for photo pins (rendered as a billboarded deck.gl IconLayer).
const CAMERA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="14" fill="#272727" stroke="#ffffff" stroke-width="2.5"/>' +
  '<rect x="14.2" y="11.8" width="5.6" height="3" rx="1" fill="#ffffff"/>' +
  '<rect x="9.5" y="13.8" width="15" height="10.7" rx="2.2" fill="#ffffff"/>' +
  '<circle cx="17" cy="19.2" r="3.4" fill="#272727"/>' +
  '<circle cx="17" cy="19.2" r="1.6" fill="#ffffff"/></svg>';
const CAMERA_ICON = `data:image/svg+xml,${encodeURIComponent(CAMERA_SVG)}`;

const LEAF_GREEN: [number, number, number] = [111, 174, 94];
const UNITS_KEY = "leaf-units";

// A short leader line between the flight path and the altitude label — a
// dark stem terminating in a small green dot resting right on the flight
// path, buffer so the label doesn't sit flush against the anchor itself.
const CONNECTOR_HEIGHT_PX = 14;
const CONNECTOR_STEM_WIDTH_PX = 2;
const CONNECTOR_DOT_RADIUS_PX = 2.5;
const CONNECTOR_WIDTH_PX = CONNECTOR_DOT_RADIUS_PX * 2 + 1; // +1px anti-aliasing margin
const CONNECTOR_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CONNECTOR_WIDTH_PX}" height="${CONNECTOR_HEIGHT_PX}" viewBox="0 0 ${CONNECTOR_WIDTH_PX} ${CONNECTOR_HEIGHT_PX}">` +
  `<line x1="${CONNECTOR_WIDTH_PX / 2}" y1="0" x2="${CONNECTOR_WIDTH_PX / 2}" y2="${CONNECTOR_HEIGHT_PX - CONNECTOR_DOT_RADIUS_PX}" stroke="#272727" stroke-width="${CONNECTOR_STEM_WIDTH_PX}"/>` +
  `<circle cx="${CONNECTOR_WIDTH_PX / 2}" cy="${CONNECTOR_HEIGHT_PX - CONNECTOR_DOT_RADIUS_PX}" r="${CONNECTOR_DOT_RADIUS_PX}" fill="rgb(${LEAF_GREEN.join(",")})"/>` +
  `</svg>`;
const CONNECTOR_ICON = `data:image/svg+xml,${encodeURIComponent(CONNECTOR_SVG)}`;

const NAME_FONT_PX = 11;
const NAME_FONT_WEIGHT = 700;
const NAME_FONT_FAMILY = "Arial, Helvetica, sans-serif";
const NAME_PADDING_PX = 9; // breathing room above/below the name within the band
const MIN_NAME_CHARS = 10; // the band is never shorter than this many characters need
const BAND_WIDTH_PX = 17;
const BADGE_SIZE_PX = 30;
const BADGE_CORNER_RATIO = 0.175; // rounded-corner radius, as a fraction of BADGE_SIZE_PX
const BADGE_GAP_PX = 0; // badge sits flush on the band — no gap

const ALT_LABEL_FONT_PX = 10;
const ALT_LABEL_PADDING_X = 5;
const ALT_LABEL_PADDING_Y = 3;

let measureCtx: CanvasRenderingContext2D | null | undefined;
function textMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  return measureCtx;
}
function measureTextPx(text: string, fontPx: number, fontWeight: number, fontFamily: string): number {
  const ctx = textMeasureCtx();
  if (!ctx) return text.length * fontPx * 0.6; // rough fallback if canvas is ever unavailable
  ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

// The "glider-altitude" TextLayer's exact rendered height (background box).
// Per deck.gl's own TextBackgroundLayer vertex shader, this is
// `getSize * lineHeight + paddingTop + paddingBottom` — NOT glyph ink
// extents (no ascent/descent involved at all) — so with the default
// lineHeight (1.0, unset below) this is exactly fontSize + 2*paddingY.
// Badge/band placement depends on this being exact, or the badge ends up
// floating above the label with a visible gap (or sinking into it) instead
// of sitting flush on top.
const ALT_LABEL_HEIGHT_PX = ALT_LABEL_FONT_PX + ALT_LABEL_PADDING_Y * 2;

interface MarkerIcon {
  url: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

const markerIconCache = new Map<string, MarkerIcon>();
/**
 * Renders the whole glider marker — the dark paraglider badge, the green
 * name-plate band, and the (vertically rotated) pilot name — onto ONE
 * offscreen canvas, anchored at its own bottom-centre (where the band meets
 * the flight path). A single canvas image sized and positioned entirely in
 * pixels via one IconLayer sidesteps two real problems with composing this
 * from separate deck.gl primitives: TextLayer's getAngle rotation silently
 * truncates a billboarded string after a few characters in this deck.gl
 * version, and a world-metres PathLayer "pole" has no reliable way to track
 * a fixed on-screen length under a pitched 3D camera — the flat ground-plane
 * meters-per-pixel formula doesn't apply to a vertical distance under
 * perspective, so the band and the name text drifted out of sync depending
 * on zoom, with the name spilling past the band into the plain background.
 * Baking everything into one image guarantees the band and the name always
 * scale together, exactly, at any zoom.
 */
function verticalMarkerIcon(name: string | null): MarkerIcon | null {
  const cacheKey = name ?? "";
  const cached = markerIconCache.get(cacheKey);
  if (cached) return cached;
  if (typeof document === "undefined") return null;

  // Never shorter than MIN_NAME_CHARS' worth of width, so the marker's size
  // stays consistent across pilots instead of shrinking to fit a short name
  // ("M" repeated is a wide, safe stand-in for measuring a worst-case run of
  // MIN_NAME_CHARS characters at this font).
  const minTextWidth = measureTextPx("M".repeat(MIN_NAME_CHARS), NAME_FONT_PX, NAME_FONT_WEIGHT, NAME_FONT_FAMILY);
  const nameTextWidth = name ? measureTextPx(name, NAME_FONT_PX, NAME_FONT_WEIGHT, NAME_FONT_FAMILY) : 0;
  const bandHeight = Math.ceil(Math.max(nameTextWidth, minTextWidth)) + NAME_PADDING_PX * 2;
  const width = BADGE_SIZE_PX;
  const height = BADGE_SIZE_PX + BADGE_GAP_PX + bandHeight;
  const bandY = BADGE_SIZE_PX + BADGE_GAP_PX;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // The green band.
  ctx.fillStyle = `rgb(${LEAF_GREEN.join(",")})`;
  ctx.fillRect((width - BAND_WIDTH_PX) / 2, bandY, BAND_WIDTH_PX, bandHeight);

  // The pilot's name, rotated to run up the band.
  if (name) {
    ctx.save();
    ctx.translate(width / 2, bandY + bandHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `${NAME_FONT_WEIGHT} ${NAME_FONT_PX}px ${NAME_FONT_FAMILY}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 0, 0);
    ctx.restore();
  }

  // The dark paraglider badge.
  const r = BADGE_SIZE_PX * BADGE_CORNER_RATIO;
  ctx.fillStyle = "#272727";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(width, 0, width, BADGE_SIZE_PX, r);
  ctx.arcTo(width, BADGE_SIZE_PX, 0, BADGE_SIZE_PX, r);
  ctx.arcTo(0, BADGE_SIZE_PX, 0, 0, r);
  ctx.arcTo(0, 0, width, 0, r);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  const cx = width / 2;
  const canopyY = BADGE_SIZE_PX * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.24, canopyY);
  ctx.quadraticCurveTo(cx, BADGE_SIZE_PX * 0.12, cx + width * 0.24, canopyY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.2, canopyY);
  ctx.lineTo(cx - width * 0.06, BADGE_SIZE_PX * 0.78);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.2, canopyY);
  ctx.lineTo(cx + width * 0.06, BADGE_SIZE_PX * 0.78);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, BADGE_SIZE_PX * 0.82, 1.8, 0, Math.PI * 2);
  ctx.fill();

  const icon: MarkerIcon = { url: canvas.toDataURL(), width, height, anchorX: width / 2, anchorY: height };
  markerIconCache.set(cacheKey, icon);
  return icon;
}

export type CameraMode = "follow" | "chase" | "fixed";

interface ReplayData {
  samples: Sample[];
  vario: number[];
  bounds: [number, number, number, number];
  durationS: number;
  altSource: "baro" | "gps";
  takeoffMs: number;
  offsetMin: number;
}

type GeoJsonData = Parameters<maplibregl.GeoJSONSource["setData"]>[0];

// True vertical scale (1.0): the track's real altitude and the real terrain
// elevation share one reference, so the flight path sits correctly on/above the
// ground. Exaggerating terrain would also inflate the track's height-above-ground
// by the same factor, so it must stay applied to BOTH if ever changed.
const TERRAIN_EXAGGERATION = 1.0;
const CHASE_PITCH = 66;
// Top padding for the follow/chase camera's centering — shifts the
// geographic centre DOWN on screen (MapLibre centres within the padded/inset
// region, not the raw container). The glider marker's badge and name-plate
// extend UPWARD from the glider's own position, so centering the raw
// position alone leaves the marker skewed toward the top of frame — partly
// behind the instrument-readout overlay. Padding roughly the readout's
// height plus half a typical marker height puts the whole marker near the
// visible centre instead of just its anchor point.
const MARKER_CENTERING_TOP_PADDING_PX = 160;
const SHADOW_SOURCE_ID = "flight-ground-shadow";
const SHADOW_LAYER_ID = "flight-ground-shadow";

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

/** Imperative one-shot camera actions a parent can trigger via ref, distinct
 *  from the continuous follow/chase driven by the cameraMode prop. */
export interface FlightReplay3DHandle {
  /** Snap the camera to the glider's current position, regardless of cameraMode. */
  centerOnPilot: () => void;
  /** Pull back to an overview framing the whole flight path. */
  fitToRoute: () => void;
}

interface FlightReplay3DProps {
  flightId: string;
  basemap?: BasemapId;
  /** Shared replay time (s from takeoff) — drives the glider position. */
  time: number;
  /** Follow the glider, chase behind it, or leave the camera free/fixed. */
  cameraMode?: CameraMode;
  /** Draw a subtle terrain-draped footprint of the flight path. */
  showShadow?: boolean;
  /** Geotagged photos to pin on the 3D track. */
  photos?: FlightPhoto[];
  /** Shown on the glider marker's pole. Omit to show no name label. */
  pilotName?: string | null;
  /** Hovering a photo pin moves the scrubber to its time-from-takeoff. */
  onPhotoHover?: (tSec: number) => void;
  /** Clicking a photo pin opens it (lightbox) and moves the scrubber. */
  onPhotoOpen?: (photoId: string, tSec: number | null) => void;
}

export const FlightReplay3D = forwardRef<FlightReplay3DHandle, FlightReplay3DProps>(
  function FlightReplay3D(
    {
      flightId,
      basemap = "monochrome",
      time,
      cameraMode = "follow",
      showShadow = false,
      photos = [],
      pilotName,
      onPhotoHover,
      onPhotoOpen,
    },
    ref,
  ) {
  // The glider marker's altitude readout honors the same persisted
  // Metric/Imperial preference as the flight page's key-statistics card
  // (read once at mount, not live-synced if changed elsewhere afterward).
  const [units] = useState<UnitSystem>(() => {
    if (typeof window === "undefined") return "metric";
    return localStorage.getItem(UNITS_KEY) === "imperial" ? "imperial" : "metric";
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dataRef = useRef<ReplayData | null>(null);
  const segmentsRef = useRef<
    { path: number[][]; t: number; color: [number, number, number] }[]
  >([]);
  const timeRef = useRef(time);
  const basemapRef = useRef(basemap);
  const cameraModeRef = useRef(cameraMode);
  const showShadowRef = useRef(showShadow);
  const chaseBearingRef = useRef<number | null>(null);
  const didInitBasemap = useRef(false);
  // Vertical offset (m) that snaps takeoff altitude to the terrain (corrects the
  // IGC baro/GPS reference vs the DEM's sea-level reference).
  const offsetRef = useRef(0);
  const anchoredRef = useRef(false);
  const anchorTimerRef = useRef<number | null>(null);
  const photosRef = useRef(photos);
  const onPhotoHoverRef = useRef(onPhotoHover);
  const onPhotoOpenRef = useRef(onPhotoOpen);
  const pilotNameRef = useRef(pilotName);
  const unitsRef = useRef(units);
  // Suppress the follow/chase recenter for a photo-hover scrub (otherwise the
  // recenter slides the icon out from under the cursor mid-hover).
  const suppressFollowRef = useRef(false);
  useEffect(() => {
    photosRef.current = photos;
    onPhotoHoverRef.current = onPhotoHover;
    onPhotoOpenRef.current = onPhotoOpen;
    pilotNameRef.current = pilotName;
    unitsRef.current = units;
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

  /**
   * Queried terrain elevation at a point, or null if not reliably known yet.
   * queryTerrainElevation returns 0 (not null) before the DEM tile at THIS
   * point is cached — the glider moves into fresh, not-yet-loaded tile
   * territory as the replay progresses, not just once at load — and can hand
   * back other transient garbage near a tile boundary, so reject anything
   * outside a plausible real-world elevation too (the same sanity clamp the
   * takeoff-anchor snap elsewhere in this file already uses).
   */
  function groundElevationAt(lon: number, lat: number): number | null {
    const map = mapRef.current;
    if (!map) return null;
    let ground: number | null = null;
    try {
      ground = map.queryTerrainElevation([lon, lat]);
    } catch {
      ground = null;
    }
    if (ground == null || !Number.isFinite(ground) || ground === 0 || ground < -500 || ground > 9000) {
      return null;
    }
    return ground;
  }

  /**
   * The glider marker's anchor height at a 3D point — whichever is HIGHER of
   * the flight path itself or the real terrain there. The recorded track can
   * dip below the terrain surface (GPS/baro noise, DEM resolution), and
   * anchoring to it alone in that case would bury the marker in/behind the
   * terrain mesh. The camera's own look-at elevation uses this too — anchor
   * the marker up here but leave the camera looking at the raw altitude, and
   * a big enough gap between the two can push the marker outside the
   * camera's view frustum entirely.
   */
  function markerAnchorZ(pos: [number, number, number]): number {
    const ground = groundElevationAt(pos[0], pos[1]);
    const flightZ = zOf(pos[2]);
    return ground != null ? Math.max(flightZ, ground) : flightZ;
  }

  function normalizeBearing(bearing: number) {
    return ((bearing % 360) + 360) % 360;
  }

  function angularDelta(from: number, to: number) {
    return ((((to - from) % 360) + 540) % 360) - 180;
  }

  function easedChaseBearing(t: number) {
    const map = mapRef.current;
    const d = dataRef.current;
    if (!map || !d) return map?.getBearing() ?? 0;
    const heading = headingAt(d.samples, t);
    // Chase bearing = the travel heading. In MapLibre, bearing is the compass
    // direction at the TOP of the screen, so bearing == heading puts the glider's
    // travel toward the top and the camera BEHIND it, looking forward.
    if (heading == null) {
      // Thermalling / no stable heading — hold the last bearing (don't spin).
      return chaseBearingRef.current ?? normalizeBearing(map.getBearing());
    }
    // On entering chase (ref cleared) snap straight behind; otherwise ease so
    // turns are smooth, not jerky.
    if (chaseBearingRef.current == null) {
      chaseBearingRef.current = heading;
      return heading;
    }
    const next = normalizeBearing(
      chaseBearingRef.current + angularDelta(chaseBearingRef.current, heading) * 0.2,
    );
    chaseBearingRef.current = next;
    return next;
  }

  // Follow/chase camera: make the glider marker itself the camera's look-at
  // point, so distance (zoom) stays constant as it flies. Uses the SAME
  // ground-clamped anchor height the marker itself renders at (markerAnchorZ)
  // — looking at the raw flight altitude while the marker renders higher (or
  // vice versa) can separate the two enough that the marker falls outside
  // the camera's view frustum entirely. Follow leaves pitch/bearing as the
  // user set them; chase also eases bearing to the damped track heading and
  // holds a steep pitch. Needs setCenterClampedToGround(false) so the centre
  // can sit above the terrain.
  function centerOnGlider(t: number, chase = false) {
    const map = mapRef.current;
    if (!map || !dataRef.current) return;
    if (map.getCenterClampedToGround()) map.setCenterClampedToGround(false);
    const p = positionAt(t);
    map.jumpTo({
      center: [p[0], p[1]],
      elevation: markerAnchorZ(p),
      padding: { top: MARKER_CENTERING_TOP_PADDING_PX, bottom: 0, left: 0, right: 0 },
      ...(chase ? { bearing: easedChaseBearing(t), pitch: CHASE_PITCH } : {}),
    });
  }

  // Pull back to an overview of the whole flight path. bearing/pitch are
  // passed INTO fitBounds itself (not applied after) — cameraForBounds
  // computes center/zoom for bearing 0 unless told otherwise, so leaving
  // bearing out fits the box as if north-up, then rotating afterward swings
  // the (non-square) bounding box off-center toward one corner. Folding
  // pitch in here too lets an animated re-fit tilt smoothly in the same
  // motion instead of snapping pitch at the end.
  function fitToRoute(duration = 0) {
    const map = mapRef.current;
    const d = dataRef.current;
    if (!map || !d) return;
    if (map.getCenterClampedToGround() === false) map.setCenterClampedToGround(true);
    map.fitBounds(
      [
        [d.bounds[0], d.bounds[1]],
        [d.bounds[2], d.bounds[3]],
      ],
      { padding: 60, duration, bearing: -20, pitch: 62 },
    );
  }

  function centerOnPilot() {
    centerOnGlider(timeRef.current, cameraModeRef.current === "chase");
  }

  useImperativeHandle(ref, () => ({ centerOnPilot, fitToRoute: () => fitToRoute(600) }));

  function shadowGeoJson(d: ReplayData): GeoJsonData {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: d.samples.map((s) => [s[0], s[1]]),
          },
        },
      ],
    };
  }

  function removeShadow(map: maplibregl.Map) {
    if (map.getLayer(SHADOW_LAYER_ID)) map.removeLayer(SHADOW_LAYER_ID);
    if (map.getSource(SHADOW_SOURCE_ID)) map.removeSource(SHADOW_SOURCE_ID);
  }

  function syncShadow() {
    const map = mapRef.current;
    const d = dataRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (!showShadowRef.current || !d || d.samples.length < 2) {
      removeShadow(map);
      return;
    }

    const geojson = shadowGeoJson(d);
    const source = map.getSource(SHADOW_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(geojson);
    } else {
      map.addSource(SHADOW_SOURCE_ID, {
        type: "geojson",
        data: geojson,
      });
    }

    if (!map.getLayer(SHADOW_LAYER_ID)) {
      const firstSymbol = map
        .getStyle()
        .layers?.find((l) => l.type === "symbol")?.id;
      // Future option: add vertical curtain drop-lines from the airborne path.
      map.addLayer(
        {
          id: SHADOW_LAYER_ID,
          type: "line",
          source: SHADOW_SOURCE_ID,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            // A subtle grey footprint, a touch stronger than a faint shadow so
            // it reads on the terrain without competing with the coloured track.
            "line-color": "#3a3a3a",
            "line-opacity": 0.5,
            "line-width": 3,
          },
        },
        firstSymbol,
      );
    }
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

    // The ground elevation directly under the glider's current position —
    // used for the optional AGL drop-line (shadow toggle) below.
    const ground = groundElevationAt(pos[0], pos[1]);

    type DropDatum = { source: [number, number, number]; target: [number, number, number] };
    const dropLayers: LineLayer<DropDatum>[] = [];
    if (showShadowRef.current && ground != null) {
      dropLayers.push(
        new LineLayer<DropDatum>({
          id: "glider-drop",
          data: [
            {
              source: [pos[0], pos[1], zOf(pos[2])],
              target: [pos[0], pos[1], ground],
            },
          ],
          getSourcePosition: (l) => l.source,
          getTargetPosition: (l) => l.target,
          getColor: [58, 58, 58, 205],
          getWidth: 2.5,
          widthUnits: "pixels",
          widthMinPixels: 2,
        }),
      );
    }

    // The glider marker: a live altitude readout with its BOTTOM edge resting
    // exactly on the anchor point, and the badge + name-plate band (one
    // composed icon, see verticalMarkerIcon()) stacked entirely ABOVE that
    // label — never straddling the anchor from opposite sides, which used to
    // read as visually disconnected from the flight path (the badge floating
    // above it, the label hanging below it) even in ordinary flight, not
    // just when the ground clamp kicked in. Anchor height comes from
    // markerAnchorZ() (see above) — the SAME height the camera's own
    // look-at point uses, so the two can't drift apart and push the marker
    // outside the view frustum.
    type LabelDatum = { text: string; position: [number, number, number] };
    const nameText = pilotNameRef.current ? pilotNameRef.current.toUpperCase() : null;
    const markerIcon = verticalMarkerIcon(nameText);
    const anchorZ = ground != null ? Math.max(zOf(pos[2]), ground) : zOf(pos[2]);
    const anchorPos: [number, number, number] = [pos[0], pos[1], anchorZ];
    // The "ASL" readout should match wherever the marker is actually drawn —
    // when the ground clamp above wins, invert zOf() to recover the raw
    // (real-world) altitude that ground elevation corresponds to, so the
    // number never contradicts what the marker's own height is showing.
    const displayAlt =
      anchorZ > zOf(pos[2]) ? anchorZ / TERRAIN_EXAGGERATION - offsetRef.current : pos[2];
    // depthTest: false on every piece of the marker so it always paints in
    // front of the flight path (and terrain) from the camera's viewpoint,
    // rather than being cut into by whichever geometry the depth buffer says
    // is technically nearer — the track passes very close to the anchor
    // point by construction, so ordinary depth testing let it slice into the
    // label at some viewing angles.
    const poleLayers: (IconLayer<[number, number, number]> | TextLayer<LabelDatum>)[] = [
      new IconLayer<[number, number, number]>({
        id: "glider-connector",
        data: [anchorPos],
        billboard: true,
        parameters: { depthCompare: "always", depthWriteEnabled: false },
        getIcon: () => ({
          url: CONNECTOR_ICON,
          width: CONNECTOR_WIDTH_PX,
          height: CONNECTOR_HEIGHT_PX,
          anchorX: CONNECTOR_WIDTH_PX / 2,
          anchorY: CONNECTOR_HEIGHT_PX,
        }),
        getPosition: (p) => p,
        getSize: CONNECTOR_HEIGHT_PX,
        sizeUnits: "pixels",
      }),
    ];
    poleLayers.push(
      new TextLayer<LabelDatum>({
        id: "glider-altitude",
        data: [
          {
            text: `${formatAltitude(Math.round(displayAlt), unitsRef.current)} ASL`,
            position: anchorPos,
          },
        ],
        getText: (l) => l.text,
        getPosition: (l) => l.position,
        parameters: { depthCompare: "always", depthWriteEnabled: false },
        // Bottom edge sits CONNECTOR_HEIGHT_PX above the anchor (on top of
        // the leader line), growing further upward from there.
        getPixelOffset: [0, -CONNECTOR_HEIGHT_PX],
        getAlignmentBaseline: "bottom",
        getColor: [255, 255, 255],
        getSize: ALT_LABEL_FONT_PX,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: 700,
        billboard: true,
        background: true,
        getBackgroundColor: [39, 39, 39, 235],
        backgroundPadding: [ALT_LABEL_PADDING_X, ALT_LABEL_PADDING_Y],
      }),
    );
    if (markerIcon) {
      poleLayers.push(
        new IconLayer<[number, number, number]>({
          id: "glider-marker",
          data: [anchorPos],
          billboard: true,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
          getIcon: () => ({
            url: markerIcon.url,
            width: markerIcon.width,
            height: markerIcon.height,
            anchorX: markerIcon.anchorX,
            anchorY: markerIcon.anchorY,
          }),
          getPosition: (p) => p,
          // Sits flush on top of the altitude label — no gap (positive Y is
          // down, matching TextLayer's own getPixelOffset convention).
          getPixelOffset: [0, -(CONNECTOR_HEIGHT_PX + ALT_LABEL_HEIGHT_PX)],
          getSize: markerIcon.height,
          sizeUnits: "pixels",
        }),
      );
    }

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
              if (o.tSec >= 0) {
                // Only suppress when this hover actually changes the time (so the
                // flag can't go stale when re-hovering the same pin).
                if (Math.round(o.tSec) !== Math.round(timeRef.current)) {
                  suppressFollowRef.current = true;
                }
                onPhotoHoverRef.current?.(o.tSec);
              }
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
        // Plumb line glider → ground (AGL cue), with the ground-shadow toggle.
        ...dropLayers,
        // Glider marker (badge + name-plate) and its altitude readout.
        ...poleLayers,
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
    map.on("move", () => renderLayers(timeRef.current));

    map.on("load", () => {
      setupTerrain(map);

      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
      });
      map.addControl(overlay);
      overlayRef.current = overlay;

      fitToRoute(0);
      renderLayers(timeRef.current);
      syncShadow();
      // Entering 3D mid-flight with follow/chase on: centre on the glider (a fresh
      // load sits at takeoff t=0, where the fitBounds overview is preferred).
      if (cameraModeRef.current !== "fixed" && timeRef.current > 0) {
        centerOnGlider(timeRef.current, cameraModeRef.current === "chase");
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
    basemapRef.current = basemap;
    if (!map) return;
    if (!didInitBasemap.current) {
      didInitBasemap.current = true;
      return; // initial style already set at build time
    }
    const reAdd = () => {
      setupTerrain(map);
      syncShadow();
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

  // Follow/chase look at the glider above the terrain (unclamped centre); fixed
  // returns the centre to the ground for normal map interaction.
  useEffect(() => {
    cameraModeRef.current = cameraMode;
    const map = mapRef.current;
    if (!map) return;
    if (cameraMode === "chase") {
      // Clear so the first chase frame snaps straight behind the glider (to the
      // travel heading) instead of easing in from the user's manual bearing.
      chaseBearingRef.current = null;
    }
    map.setCenterClampedToGround(cameraMode === "fixed");
    if (cameraMode !== "fixed") centerOnGlider(timeRef.current, cameraMode === "chase");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode]);

  // Render the glider at the shared time; follow it with the camera if enabled.
  useEffect(() => {
    timeRef.current = time;
    cameraModeRef.current = cameraMode;
    if (cameraMode !== "fixed" && !suppressFollowRef.current) {
      centerOnGlider(time, cameraMode === "chase");
    }
    suppressFollowRef.current = false;
    renderLayers(time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, cameraMode]);

  useEffect(() => {
    showShadowRef.current = showShadow;
    syncShadow();
    // Re-render deck layers so the glider→ground plumb line appears/disappears
    // with the toggle (not just on the next time tick).
    renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showShadow, data]);

  // Re-render the photo pins when the set changes.
  useEffect(() => {
    if (overlayRef.current) renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  if (error) {
    return (
      <Card className="flex h-[70vh] min-h-[520px] items-center justify-center text-gray-500">
        3D replay unavailable.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <div ref={containerRef} className="h-[70vh] min-h-[520px] w-full" />
        {hoverPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(flightId, hoverPhoto.id, "thumb")}
            alt=""
            className="pointer-events-none absolute z-10 h-[120px] w-[120px] rounded object-cover shadow-lg ring-1 ring-black/20"
            style={{
              left: hoverPhoto.x + 16,
              top: Math.max(hoverPhoto.y - 132, 8),
            }}
          />
        )}
      </div>
    </Card>
  );
  },
);
