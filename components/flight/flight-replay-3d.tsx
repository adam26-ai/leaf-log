"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { styleFor, isImagery, type BasemapId } from "./basemaps";
import { isPinned, photoUrl, type FlightPhoto } from "./photos";
import { MultiColorPathLayer, type MultiColorPathDatum } from "./multi-color-path-layer";
import { Card } from "@/components/ui/card";
import { headingAt, locateSample, type Sample } from "@/lib/igc/interpolate";
import { formatAltitude, type UnitSystem } from "@/lib/flights/format";
import type { TerrainProfilePoint } from "@/lib/flights/terrain-profile";
import { varioReplayColor } from "./replay-palette";

// Camera icon for photo pins (rendered as a billboarded deck.gl IconLayer).
const CAMERA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="14" fill="#272727" stroke="#ffffff" stroke-width="2.5"/>' +
  '<rect x="14.2" y="11.8" width="5.6" height="3" rx="1" fill="#ffffff"/>' +
  '<rect x="9.5" y="13.8" width="15" height="10.7" rx="2.2" fill="#ffffff"/>' +
  '<circle cx="17" cy="19.2" r="3.4" fill="#272727"/>' +
  '<circle cx="17" cy="19.2" r="1.6" fill="#ffffff"/></svg>';
const CAMERA_ICON = `data:image/svg+xml,${encodeURIComponent(CAMERA_SVG)}`;

const LEAF_GREEN: [number, number, number] = [216, 255, 0];
// White-on-black front view of a paraglider: a curved ram-air canopy,
// suspension lines, and the pilot below it.
const GLIDER_ICON_WIDTH_PX = 24;
const GLIDER_ICON_SOURCE_WIDTH = 104;
const GLIDER_ICON_SOURCE_HEIGHT = 76;
const GLIDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="104" height="76" viewBox="0 0 52 38">' +
  '<rect width="52" height="38" rx="7" fill="#141414"/>' +
  '<path d="M6 16.5C9.2 4.8 18.2 3 26 3s16.8 1.8 20 13.5C36.5 11 15.5 11 6 16.5Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M16 6.3l-2 7.1M26 3v8M36 6.3l2 7.1" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"/>' +
  '<path d="m7.5 16 16.8 15m20.2-15-16.8 15M16 13.1l9 18m11-18-9 18" fill="none" stroke="#fff" stroke-width="1.25" stroke-linecap="round"/>' +
  '<circle cx="26" cy="31.5" r="1.9" fill="#fff"/><path d="M26 33.5v2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';
const GLIDER_ICON = `data:image/svg+xml,${encodeURIComponent(GLIDER_SVG)}`;

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

const NAME_BANNER_WIDTH_PX = 24;
const NAME_BANNER_FONT_PX = 14;
const NAME_BANNER_SCALE = 4;
const LABEL_GAP_PX = 4;

interface NameBannerIcon {
  url: string;
  width: number;
  height: number;
  displayHeight: number;
}

const nameBannerCache = new Map<string, NameBannerIcon>();

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

function verticalNameBanner(name: string | null): NameBannerIcon | null {
  if (!name) return null;
  const cached = nameBannerCache.get(name);
  if (cached) return cached;

  const displayHeight = Math.max(115, Math.ceil(name.length * 9 + 23));
  const width = NAME_BANNER_WIDTH_PX * NAME_BANNER_SCALE;
  const height = displayHeight * NAME_BANNER_SCALE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${NAME_BANNER_WIDTH_PX} ${displayHeight}">` +
    `<rect x="0.5" y="0.5" width="${NAME_BANNER_WIDTH_PX - 1}" height="${displayHeight - 1}" fill="#d8ff00" stroke="#141414"/>` +
    `<text transform="translate(${NAME_BANNER_WIDTH_PX / 2} ${displayHeight / 2}) rotate(-90)" text-anchor="middle" dominant-baseline="central" fill="#141414" font-family="Arial,Helvetica,sans-serif" font-size="${NAME_BANNER_FONT_PX}" font-weight="700">${escapeXml(name)}</text>` +
    "</svg>";
  const icon = {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width,
    height,
    displayHeight,
  };
  nameBannerCache.set(name, icon);
  return icon;
}

const ALT_LABEL_FONT_PX = 10;
const ALT_LABEL_PADDING_X = 5;
const ALT_LABEL_PADDING_Y = 3;

// The "glider-altitude" TextLayer's exact rendered height (background box).
// Per deck.gl's own TextBackgroundLayer vertex shader, this is
// `getSize * lineHeight + paddingTop + paddingBottom` — NOT glyph ink
// extents (no ascent/descent involved at all) — so with the default
// lineHeight (1.0, unset below) this is exactly fontSize + 2*paddingY.
// Badge/band placement depends on this being exact, or the badge ends up
// floating above the label with a visible gap (or sinking into it) instead
// of sitting flush on top.
const ALT_LABEL_HEIGHT_PX = ALT_LABEL_FONT_PX + ALT_LABEL_PADDING_Y * 2;

export type CameraMode = "follow" | "chase" | "orbit" | "fixed";
export type AltitudeMode = "asl" | "agl";

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
// Extra top clearance for fitToRoute's overview framing — the same
// pitch-vs-flat-fit skew MARKER_CENTERING_TOP_PADDING_PX corrects for above,
// just for the whole-route bounding box instead of one point. Tuned
// empirically against this component's 62° pitch.
const ROUTE_FIT_TOP_PADDING_PX = 260;
const SHADOW_SOURCE_ID = "flight-ground-shadow";
const SHADOW_LAYER_ID = "flight-ground-shadow";
const CURTAIN_WINDOW_S = 18;
const CURTAIN_VERTICAL_BANDS = 12;
const MAX_TERRAIN_PROFILE_POINTS = 1_000;

/**
 * Add a Catmull-Rom midpoint between every pair of fixes. The spline passes
 * through every recorded fix, so this improves curve tessellation without the
 * resolution loss caused by averaging coordinates.
 */
function splineTrack(
  samples: Sample[],
  colors: [number, number, number][],
): TimedTrackDatum {
  if (samples.length < 2) {
    return {
      path: samples.map((sample) => [sample[0], sample[1], sample[2]]),
      colors,
      times: samples.map((sample) => sample[3]),
    };
  }
  const path: number[][] = [];
  const expandedColors: [number, number, number][] = [];
  const times: number[] = [];
  const interpolate = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * 0.5 + (2 * a - 5 * b + 4 * c - d) * 0.25 + (-a + 3 * b - 3 * c + d) * 0.125);

  for (let index = 0; index < samples.length - 1; index++) {
    const p0 = samples[Math.max(0, index - 1)];
    const p1 = samples[index];
    const p2 = samples[index + 1];
    const p3 = samples[Math.min(samples.length - 1, index + 2)];
    const c1 = colors[index];
    const c2 = colors[index + 1];
    if (index === 0) {
      path.push([p1[0], p1[1], p1[2]]);
      expandedColors.push(c1);
      times.push(p1[3]);
    }
    path.push([
      interpolate(p0[0], p1[0], p2[0], p3[0]),
      interpolate(p0[1], p1[1], p2[1], p3[1]),
      interpolate(p0[2], p1[2], p2[2], p3[2]),
    ]);
    expandedColors.push([
      Math.round((c1[0] + c2[0]) / 2),
      Math.round((c1[1] + c2[1]) / 2),
      Math.round((c1[2] + c2[2]) / 2),
    ]);
    times.push((p1[3] + p2[3]) / 2);
    path.push([p2[0], p2[1], p2[2]]);
    expandedColors.push(c2);
    times.push(p2[3]);
  }
  return { path, colors: expandedColors, times };
}

interface TimedTrackDatum extends MultiColorPathDatum {
  times: number[];
}

export type TrackDisplayMode = "elapsed" | "full";

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
  /** Used to refresh the marker's screen-size correction at transport changes. */
  playing?: boolean;
  /** Follow the glider, chase behind it, or leave the camera free/fixed. */
  cameraMode?: CameraMode;
  /** Draw the terrain-draped footprint and fading altitude trails. */
  showShadow?: boolean;
  /** Reveal the route up to the pilot, or show the complete route. */
  trackDisplay?: TrackDisplayMode;
  /** Unit system and reference used by the live marker altitude label. */
  units?: UnitSystem;
  altitudeMode?: AltitudeMode;
  /** Geotagged photos to pin on the 3D track. */
  photos?: FlightPhoto[];
  /** Shown on the glider marker's pole. Omit to show no name label. */
  pilotName?: string | null;
  /** Hovering a photo pin moves the scrubber to its time-from-takeoff. */
  onPhotoHover?: (tSec: number) => void;
  /** Clicking a photo pin opens it (lightbox) and moves the scrubber. */
  onPhotoOpen?: (photoId: string, tSec: number | null) => void;
  /** Reports sampled DEM heights along the route for the altitude profile. */
  onTerrainProfile?: (profile: TerrainProfilePoint[]) => void;
  /** Switch the parent camera mode when a manual gesture needs a free camera. */
  onManualCameraChange?: () => void;
}

export const FlightReplay3D = forwardRef<FlightReplay3DHandle, FlightReplay3DProps>(
  function FlightReplay3D(
    {
      flightId,
      basemap = "monochrome",
      time,
      playing = false,
      cameraMode = "follow",
      showShadow = true,
      trackDisplay = "elapsed",
      units = "metric",
      altitudeMode = "asl",
      photos = [],
      pilotName,
      onPhotoHover,
      onPhotoOpen,
      onTerrainProfile,
      onManualCameraChange,
    },
    ref,
  ) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dataRef = useRef<ReplayData | null>(null);
  const trackRef = useRef<TimedTrackDatum | null>(null);
  const timeRef = useRef(time);
  const basemapRef = useRef(basemap);
  const cameraModeRef = useRef(cameraMode);
  const showShadowRef = useRef(showShadow);
  const trackDisplayRef = useRef(trackDisplay);
  const displayedTrackCacheRef = useRef<{
    source: TimedTrackDatum;
    count: number;
    value: MultiColorPathDatum;
  } | null>(null);
  const chaseBearingRef = useRef<number | null>(null);
  const chasePitchRef = useRef(CHASE_PITCH);
  const orbitStateRef = useRef<{
    bearing: number;
    timestamp: number;
    paused: boolean;
  } | null>(null);
  const zoomAnimationRef = useRef(false);
  const wheelZoomUntilRef = useRef(0);
  const trackedZoomAnimationRef = useRef<number | null>(null);
  const manualCameraInteractionRef = useRef<"rotate" | "pan" | null>(null);
  const preserveCameraOnFixedRef = useRef(false);
  const didInitBasemap = useRef(false);
  // Vertical offset (m) that snaps takeoff altitude to the terrain (corrects the
  // IGC baro/GPS reference vs the DEM's sea-level reference).
  const offsetRef = useRef(0);
  const anchoredRef = useRef(false);
  const anchorTimerRef = useRef<number | null>(null);
  const styleRefreshTimerRef = useRef<number | null>(null);
  const groundElevationCacheRef = useRef(new Map<number, number>());
  const shadowSampleCountRef = useRef(-1);
  const photosRef = useRef(photos);
  const onPhotoHoverRef = useRef(onPhotoHover);
  const onPhotoOpenRef = useRef(onPhotoOpen);
  const onTerrainProfileRef = useRef(onTerrainProfile);
  const terrainProfilePublishedRef = useRef(false);
  const onManualCameraChangeRef = useRef(onManualCameraChange);
  const pilotNameRef = useRef(pilotName);
  const unitsRef = useRef(units);
  const altitudeModeRef = useRef(altitudeMode);
  // Suppress the follow/chase recenter for a photo-hover scrub (otherwise the
  // recenter slides the icon out from under the cursor mid-hover).
  const suppressFollowRef = useRef(false);
  useEffect(() => {
    photosRef.current = photos;
    onPhotoHoverRef.current = onPhotoHover;
    onPhotoOpenRef.current = onPhotoOpen;
    onTerrainProfileRef.current = onTerrainProfile;
    onManualCameraChangeRef.current = onManualCameraChange;
    pilotNameRef.current = pilotName;
    unitsRef.current = units;
    altitudeModeRef.current = altitudeMode;
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
        groundElevationCacheRef.current.clear();
        terrainProfilePublishedRef.current = false;
        displayedTrackCacheRef.current = null;
        dataRef.current = d;
        trackRef.current = splineTrack(
          d.samples,
          d.samples.map((_, index) => varioReplayColor(d.vario[index] ?? 0)),
        );
        setData(d);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [flightId]);

  function positionAt(t: number): [number, number, number] {
    const s = dataRef.current!.samples;
    const { i, f } = locateSample(s, t);
    const a = s[i - 1];
    const b = s[i];
    return [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ];
  }

  function varioAt(t: number): number {
    const d = dataRef.current!;
    const { i, f } = locateSample(d.samples, t);
    return (d.vario[i - 1] ?? 0) + ((d.vario[i] ?? 0) - (d.vario[i - 1] ?? 0)) * f;
  }

  // Map a raw IGC altitude to the scene's vertical space (takeoff anchor offset,
  // then terrain exaggeration so the track stays consistent with the mesh).
  function zOf(alt: number) {
    return (alt + offsetRef.current) * TERRAIN_EXAGGERATION;
  }

  /**
   * Queried terrain elevation at a point, or null if not reliably known yet.
   * queryTerrainElevation can return 0 (not null) before the DEM is ready, so
   * accept zero only once the source reports loaded (real sea-level terrain is
   * valid). Reject elevations outside a plausible real-world range too.
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
    const terrainIsLoaded = map.getSource("dem")
      ? map.isSourceLoaded("dem")
      : false;
    if (
      ground == null ||
      !Number.isFinite(ground) ||
      (ground === 0 && !terrainIsLoaded) ||
      ground < -500 ||
      ground > 9000
    ) {
      return null;
    }
    return ground;
  }

  function cachedGroundElevationAt(cacheKey: number, lon: number, lat: number): number | null {
    const cached = groundElevationCacheRef.current.get(cacheKey);
    if (cached != null) return cached;
    const ground = groundElevationAt(lon, lat);
    if (ground != null) groundElevationCacheRef.current.set(cacheKey, ground);
    return ground;
  }

  function displayedTrackAt(track: TimedTrackDatum, t: number): MultiColorPathDatum {
    if (trackDisplayRef.current === "full") return track;
    let low = 0;
    let high = track.times.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (track.times[middle] <= t) low = middle + 1;
      else high = middle;
    }
    const count = Math.max(2, Math.min(track.path.length, low));
    const cached = displayedTrackCacheRef.current;
    if (cached?.source === track && cached.count === count) return cached.value;
    const value = {
      path: track.path.slice(0, count),
      colors: track.colors.slice(0, count),
    };
    displayedTrackCacheRef.current = { source: track, count, value };
    return value;
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

  /**
   * deck.gl's pixel-sized billboards use the camera target's focal depth.
   * When a pitched pan moves the pilot nearer or farther than that target,
   * their apparent size changes even though sizeUnits is "pixels". Scale the
   * marker by its view-depth ratio so the final projected size stays fixed.
   */
  function markerPerspectiveScale(position: [number, number, number]): number {
    const map = mapRef.current;
    if (!map) return 1;
    const target = maplibregl.MercatorCoordinate.fromLngLat(
      map.getCenter(),
      map.getCameraTargetElevation(),
    );
    const marker = maplibregl.MercatorCoordinate.fromLngLat(
      [position[0], position[1]],
      position[2],
    );
    const pitch = (map.getPitch() * Math.PI) / 180;
    const bearing = (map.getBearing() * Math.PI) / 180;
    const forwardX = Math.sin(pitch) * Math.sin(bearing);
    const forwardY = -Math.sin(pitch) * Math.cos(bearing);
    const forwardZ = Math.cos(pitch);
    const fov = (map.getVerticalFieldOfView() * Math.PI) / 180;
    const cameraToCenterPixels = map.getCanvas().clientHeight / 2 / Math.tan(fov / 2);
    const targetDepth = cameraToCenterPixels / (512 * 2 ** map.getZoom());
    if (!Number.isFinite(targetDepth) || targetDepth <= 0) return 1;
    const markerDepth =
      targetDepth +
      (marker.x - target.x) * forwardX +
      (marker.y - target.y) * forwardY +
      (marker.z - target.z) * forwardZ;
    if (!Number.isFinite(markerDepth) || markerDepth <= 0) return 1;
    return Math.max(0.05, Math.min(20, markerDepth / targetDepth));
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
  function centerOnGlider(
    t: number,
    chase = false,
    orbitBearing?: number,
    zoom?: number,
  ) {
    const map = mapRef.current;
    if (!map || !dataRef.current) return;
    if (map.getCenterClampedToGround()) map.setCenterClampedToGround(false);
    const p = positionAt(t);
    map.jumpTo({
      center: [p[0], p[1]],
      elevation: markerAnchorZ(p),
      padding: { top: MARKER_CENTERING_TOP_PADDING_PX, bottom: 0, left: 0, right: 0 },
      ...(zoom != null ? { zoom } : {}),
      ...(chase
        ? { bearing: easedChaseBearing(t), pitch: chasePitchRef.current }
        : orbitBearing != null
          ? { bearing: orbitBearing }
          : {}),
    });
  }

  // Pull back to an overview of the whole flight path. bearing/pitch are
  // passed INTO fitBounds itself (not applied after) — cameraForBounds
  // computes center/zoom for bearing 0 unless told otherwise, so leaving
  // bearing out fits the box as if north-up, then rotating afterward swings
  // the (non-square) bounding box off-center toward one corner. Folding
  // pitch in here too lets an animated re-fit tilt smoothly in the same
  // motion instead of snapping pitch at the end.
  //
  // Padding is deliberately NOT uniform: fitBounds computes center/zoom as
  // if the camera were looking straight down, then the pitch is applied on
  // top. Under a steep pitch, that flat-computed "center" renders much
  // closer to the TOP of frame than its flat-projection position suggests —
  // confirmed empirically (the resulting camera params are 100%
  // reproducible; only the on-screen position looks off, every time, at
  // every zoom/basemap-load state — so this is a pitch/padding calibration
  // issue, not a data-loading race). Reserving extra clearance at the top
  // pushes the fitted content down toward the visual centre instead.
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
      {
        padding: { top: ROUTE_FIT_TOP_PADDING_PX, bottom: 60, left: 60, right: 60 },
        duration,
        bearing: -20,
        pitch: 62,
      },
    );
  }

  function centerOnPilot() {
    centerOnGlider(timeRef.current, cameraModeRef.current === "chase");
  }

  useImperativeHandle(ref, () => ({ centerOnPilot, fitToRoute: () => fitToRoute(600) }));

  function shadowGeoJson(d: ReplayData, t: number): GeoJsonData {
    const samples =
      trackDisplayRef.current === "full"
        ? d.samples
        : d.samples.slice(0, Math.max(2, locateSample(d.samples, t).i + 1));
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: samples.map((s) => [s[0], s[1]]),
          },
        },
      ],
    };
  }

  function removeShadow(map: maplibregl.Map) {
    if (map.getLayer(SHADOW_LAYER_ID)) map.removeLayer(SHADOW_LAYER_ID);
    if (map.getSource(SHADOW_SOURCE_ID)) map.removeSource(SHADOW_SOURCE_ID);
    shadowSampleCountRef.current = -1;
  }

  function syncShadow() {
    const map = mapRef.current;
    const d = dataRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (!showShadowRef.current || !d || d.samples.length < 2) {
      removeShadow(map);
      return;
    }

    const source = map.getSource(SHADOW_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    const sampleCount =
      trackDisplayRef.current === "full"
        ? d.samples.length
        : Math.max(2, locateSample(d.samples, timeRef.current).i + 1);
    if (!source) {
      map.addSource(SHADOW_SOURCE_ID, {
        type: "geojson",
        data: shadowGeoJson(d, timeRef.current),
      });
      shadowSampleCountRef.current = sampleCount;
    } else if (shadowSampleCountRef.current !== sampleCount) {
      source.setData(shadowGeoJson(d, timeRef.current));
      shadowSampleCountRef.current = sampleCount;
    }

    // A style diff can preserve our source while dropping its layer. Always
    // check the layer separately so the ground line is restored after a map
    // view change even when its underlying GeoJSON is already current.
    if (!map.getLayer(SHADOW_LAYER_ID)) {
      const firstSymbol = map
        .getStyle()
        .layers?.find((l) => l.type === "symbol")?.id;
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
    const track = trackRef.current;
    if (!overlay || !d || !track) return;
    const displayedTrack = displayedTrackAt(track, t);
    const pos = positionAt(t);
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

    // The ground elevation directly under the glider's current position.
    const ground = groundElevationAt(pos[0], pos[1]);

    type CurtainDatum = {
      polygon: [number, number, number][];
      color: [number, number, number, number];
    };
    const curtainLayers: SolidPolygonLayer<CurtainDatum>[] = [];
    if (showShadowRef.current) {
      type CurtainSample = {
        time: number;
        position: [number, number, number];
        ground: number;
        top: number;
        recency: number;
      };
      const start = Math.max(0, t - CURTAIN_WINDOW_S);
      const sampleCount = Math.max(2, Math.ceil(t - start) + 1);
      const curtainSamples: CurtainSample[] = [];
      for (let index = 0; index < sampleCount; index++) {
        const sampleTime = start + ((t - start) * index) / (sampleCount - 1);
        const samplePos = positionAt(sampleTime);
        const sampleGround = cachedGroundElevationAt(
          Math.round(sampleTime),
          samplePos[0],
          samplePos[1],
        );
        if (sampleGround == null) continue;
        const recency = Math.max(0, Math.min(1, 1 - (t - sampleTime) / CURTAIN_WINDOW_S));
        curtainSamples.push({
          time: sampleTime,
          position: samplePos,
          ground: sampleGround,
          // The trailing edge collapses toward the terrain as it fades. This
          // makes a continuous wake rather than a row of separate drop bars.
          top: sampleGround + Math.max(0, zOf(samplePos[2]) - sampleGround) * recency,
          recency,
        });
      }

      const curtain: CurtainDatum[] = [];
      for (let index = 1; index < curtainSamples.length; index++) {
        const a = curtainSamples[index - 1];
        const b = curtainSamples[index];
        const temporal = Math.pow((a.recency + b.recency) / 2, 1.35);
        const [red, green, blue] = varioReplayColor(varioAt((a.time + b.time) / 2));
        for (let band = 0; band < CURTAIN_VERTICAL_BANDS; band++) {
          const lower = band / CURTAIN_VERTICAL_BANDS;
          const upper = (band + 1) / CURTAIN_VERTICAL_BANDS;
          const verticalFade = Math.pow(1 - (lower + upper) / 2, 0.7);
          const alpha = Math.round(184 * temporal * verticalFade);
          if (alpha < 2) continue;
          curtain.push({
            polygon: [
              [a.position[0], a.position[1], a.ground + (a.top - a.ground) * lower],
              [b.position[0], b.position[1], b.ground + (b.top - b.ground) * lower],
              [b.position[0], b.position[1], b.ground + (b.top - b.ground) * upper],
              [a.position[0], a.position[1], a.ground + (a.top - a.ground) * upper],
            ],
            color: [red, green, blue, alpha],
          });
        }
      }
      if (curtain.length > 0) {
        curtainLayers.push(
          new SolidPolygonLayer<CurtainDatum>({
            id: "altitude-time-curtain-mesh",
            data: curtain,
            getPolygon: (segment) => segment.polygon,
            getFillColor: (segment) => segment.color,
            filled: true,
            extruded: false,
            pickable: false,
            material: false,
            // The curtain polygons are vertical; normal polygon tessellation
            // projects to lon/lat and collapses them to zero area.
            _full3d: true,
            parameters: {
              cullMode: "none",
              depthWriteEnabled: false,
              depthCompare: "less-equal",
            },
          }),
        );
      }
    }

    // Stack the connector, live altitude, vertical SVG name banner, and
    // white-on-black glider above one ground-clamped anchor.
    type LabelDatum = { text: string; position: [number, number, number] };
    const nameText = pilotNameRef.current ? pilotNameRef.current.toUpperCase() : null;
    const nameBanner = verticalNameBanner(nameText);
    const anchorZ = ground != null ? Math.max(zOf(pos[2]), ground) : zOf(pos[2]);
    const anchorPos: [number, number, number] = [pos[0], pos[1], anchorZ];
    const markerScale = markerPerspectiveScale(anchorPos);
    const markerPixels = (pixels: number) => pixels * markerScale;
    // The "ASL" readout should match wherever the marker is actually drawn —
    // when the ground clamp above wins, invert zOf() to recover the raw
    // (real-world) altitude that ground elevation corresponds to, so the
    // number never contradicts what the marker's own height is showing.
    const displayAltAsl =
      anchorZ > zOf(pos[2]) ? anchorZ / TERRAIN_EXAGGERATION - offsetRef.current : pos[2];
    const isAgl = altitudeModeRef.current === "agl";
    const displayAlt = isAgl && ground != null
      ? Math.max(0, (anchorZ - ground) / TERRAIN_EXAGGERATION)
      : displayAltAsl;
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
        getSize: markerPixels(CONNECTOR_HEIGHT_PX),
        sizeUnits: "pixels",
      }),
    ];
    poleLayers.push(
      new TextLayer<LabelDatum>({
        id: "glider-altitude",
        data: [
          {
            text: `${formatAltitude(Math.round(displayAlt), unitsRef.current)} ${isAgl ? "AGL" : "MSL"}`,
            position: anchorPos,
          },
        ],
        getText: (l) => l.text,
        getPosition: (l) => l.position,
        parameters: { depthCompare: "always", depthWriteEnabled: false },
        // Bottom edge sits CONNECTOR_HEIGHT_PX above the anchor (on top of
        // the leader line), growing further upward from there.
        getPixelOffset: [0, -markerPixels(CONNECTOR_HEIGHT_PX)],
        getAlignmentBaseline: "bottom",
        getColor: [255, 255, 255],
        getSize: markerPixels(ALT_LABEL_FONT_PX),
        sizeUnits: "pixels",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: 700,
        billboard: true,
        background: true,
        getBackgroundColor: [39, 39, 39, 235],
        backgroundPadding: [
          markerPixels(ALT_LABEL_PADDING_X),
          markerPixels(ALT_LABEL_PADDING_Y),
        ],
      }),
    );
    if (nameBanner) {
      poleLayers.push(
        new IconLayer<[number, number, number]>({
          id: "glider-name",
          data: [anchorPos],
          billboard: true,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
          getIcon: () => ({
            url: nameBanner.url,
            width: nameBanner.width,
            height: nameBanner.height,
            anchorX: nameBanner.width / 2,
            anchorY: nameBanner.height,
          }),
          getPosition: (p) => p,
          getPixelOffset: [
            0,
            -markerPixels(CONNECTOR_HEIGHT_PX + ALT_LABEL_HEIGHT_PX + LABEL_GAP_PX),
          ],
          getSize: markerPixels(nameBanner.displayHeight),
          sizeUnits: "pixels",
          sizeBasis: "height",
        }),
      );
    }
    const iconBottomOffset =
      CONNECTOR_HEIGHT_PX +
      ALT_LABEL_HEIGHT_PX +
      LABEL_GAP_PX +
      (nameBanner ? nameBanner.displayHeight + LABEL_GAP_PX : 0);
    poleLayers.push(
      new IconLayer<[number, number, number]>({
        id: "glider-marker",
        data: [anchorPos],
        billboard: true,
        parameters: { depthCompare: "always", depthWriteEnabled: false },
        getIcon: () => ({
          url: GLIDER_ICON,
          width: GLIDER_ICON_SOURCE_WIDTH,
          height: GLIDER_ICON_SOURCE_HEIGHT,
          anchorX: GLIDER_ICON_SOURCE_WIDTH / 2,
          anchorY: GLIDER_ICON_SOURCE_HEIGHT,
        }),
        getPosition: (p) => p,
        getPixelOffset: [0, -markerPixels(iconBottomOffset)],
        getSize: markerPixels(GLIDER_ICON_WIDTH_PX),
        sizeUnits: "pixels",
        sizeBasis: "width",
      }),
    );

    overlay.setProps({
      layers: [
        // The outline is shaded inside this one ribbon so separate halo joins
        // cannot expose black wedges at thermals and self-crossings.
        new MultiColorPathLayer({
          id: `track-outlined-v10-${trackDisplayRef.current}`,
          data: [displayedTrack],
          getPath: (flight) =>
            flight.path.map((p) => [p[0], p[1], zOf(p[2])]) as [
              number,
              number,
              number,
            ][],
          getColor: (flight) => flight.colors,
          getWidth: 5.75,
          widthUnits: "pixels",
          widthMinPixels: 5.75,
          // Face the camera so the line keeps its width when the view is tilted
          // (a flat ribbon goes edge-on and disappears at high pitch).
          billboard: true,
          parameters: { depthWriteEnabled: true, depthCompare: "less-equal" },
          capRounded: true,
          jointRounded: true,
          updateTriggers: {
            getPath: offsetRef.current,
            getColor: displayedTrack.colors,
          },
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
        // Fading recent altitude trails plus the live glider-to-ground cue.
        ...curtainLayers,
        // Vector glider marker, sharp name-plate, and live altitude readout.
        ...poleLayers,
      ],
    });
  }

  function setZoomAroundTrackedPilot(map: maplibregl.Map, zoom: number) {
    const clampedZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
    if (cameraModeRef.current === "fixed" || !dataRef.current) {
      map.setZoom(clampedZoom);
      return;
    }
    const orbitBearing =
      cameraModeRef.current === "orbit"
        ? (orbitStateRef.current?.bearing ?? map.getBearing())
        : undefined;
    centerOnGlider(
      timeRef.current,
      cameraModeRef.current === "chase",
      orbitBearing,
      clampedZoom,
    );
  }

  function setOrientationAroundTrackedPilot(
    map: maplibregl.Map,
    bearing: number,
    pitch: number,
  ) {
    if (cameraModeRef.current === "fixed" || !dataRef.current) {
      map.jumpTo({ bearing, pitch });
      return;
    }
    const p = positionAt(timeRef.current);
    map.jumpTo({
      center: [p[0], p[1]],
      elevation: markerAnchorZ(p),
      padding: { top: MARKER_CENTERING_TOP_PADDING_PX, bottom: 0, left: 0, right: 0 },
      bearing,
      pitch,
    });
  }

  function animateZoomAroundTrackedPilot(map: maplibregl.Map, delta: number) {
    map.stop();
    if (trackedZoomAnimationRef.current != null) {
      cancelAnimationFrame(trackedZoomAnimationRef.current);
    }
    const startingZoom = map.getZoom();
    const targetZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), startingZoom + delta),
    );
    if (targetZoom === startingZoom) return;

    const startedAt = performance.now();
    const duration = 300;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setZoomAroundTrackedPilot(map, startingZoom + (targetZoom - startingZoom) * eased);
      if (progress < 1) {
        trackedZoomAnimationRef.current = requestAnimationFrame(animate);
      } else {
        trackedZoomAnimationRef.current = null;
      }
    };
    trackedZoomAnimationRef.current = requestAnimationFrame(animate);
  }

  /**
   * Predictable desktop navigation: left drag always rotates/pitches in the
   * same direction, while right or middle drag pans. MapLibre's default
   * around-cursor rotation reverses bearing above the viewport midpoint,
   * which feels erratic in this steeply pitched 3D view.
   */
  function installMouseNavigation(map: maplibregl.Map): () => void {
    const element = map.getCanvasContainer();
    let drag: { mode: "rotate" | "pan"; x: number; y: number } | null = null;

    // Recentring with jumpTo interrupts MapLibre's animated +/- and pinch
    // zooms. Suspend the tracking camera until those animations finish.
    const onZoomStart = () => {
      zoomAnimationRef.current = true;
    };
    const onZoomEnd = () => {
      zoomAnimationRef.current = false;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      map.stop();
      const mode = event.button === 0 ? "rotate" : "pan";
      manualCameraInteractionRef.current = mode;
      if (mode === "rotate" && cameraModeRef.current === "orbit") {
        const orbitState = orbitStateRef.current;
        if (orbitState) orbitState.paused = true;
      }
      drag = { mode, x: event.clientX, y: event.clientY };
      element.style.cursor = "grabbing";
      event.preventDefault();
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.mode === "rotate") {
        const nextPitch = Math.max(
          0,
          Math.min(map.getMaxPitch(), map.getPitch() - dy * 0.25),
        );
        if (cameraModeRef.current === "chase") chasePitchRef.current = nextPitch;
        setOrientationAroundTrackedPilot(
          map,
          map.getBearing() + dx * 0.35,
          nextPitch,
        );
      } else {
        // Drag the world with the pointer, matching common map interaction.
        map.panBy([-dx, -dy], { duration: 0 });
      }
      event.preventDefault();
    };
    const onMouseUp = () => {
      if (!drag) return;
      const completedDrag = drag;
      if (completedDrag.mode === "rotate" && cameraModeRef.current === "orbit") {
        const orbitState = orbitStateRef.current;
        if (orbitState) {
          orbitState.bearing = normalizeBearing(map.getBearing());
          orbitState.timestamp = performance.now();
          orbitState.paused = false;
        }
      }
      if (completedDrag.mode === "rotate" && cameraModeRef.current === "chase") {
        chaseBearingRef.current = normalizeBearing(map.getBearing());
      }
      if (completedDrag.mode === "pan" && cameraModeRef.current !== "fixed") {
        // Panning intentionally leaves the pilot anchor. Enter Fixed without
        // changing the camera elevation, so the completed gesture is retained.
        preserveCameraOnFixedRef.current = true;
        cameraModeRef.current = "fixed";
        onManualCameraChangeRef.current?.();
      }
      drag = null;
      manualCameraInteractionRef.current = null;
      element.style.cursor = "grab";
    };
    const onWheel = (event: WheelEvent) => {
      // Each wheel step emits an immediate zoomstart/zoomend pair, so keep
      // ordinary tracking suspended briefly across the whole wheel gesture.
      wheelZoomUntilRef.current = performance.now() + 180;
      if (trackedZoomAnimationRef.current != null) {
        cancelAnimationFrame(trackedZoomAnimationRef.current);
        trackedZoomAnimationRef.current = null;
      }
      map.stop();
      const pixels =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * element.clientHeight
            : event.deltaY;
      const delta = Math.max(-1.5, Math.min(1.5, -pixels * 0.0035));
      setZoomAroundTrackedPilot(map, map.getZoom() + delta);
      event.preventDefault();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    element.style.cursor = "grab";
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onMouseUp);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    return () => {
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onMouseUp);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
    };
  }

  function cameraTrackingSuspended(now = performance.now()): boolean {
    return (
      zoomAnimationRef.current ||
      trackedZoomAnimationRef.current != null ||
      manualCameraInteractionRef.current != null ||
      now < wheelZoomUntilRef.current
    );
  }

  function installTrackedZoomButtons(map: maplibregl.Map): () => void {
    const container = map.getContainer();
    const zoomIn = container.querySelector<HTMLButtonElement>(".maplibregl-ctrl-zoom-in");
    const zoomOut = container.querySelector<HTMLButtonElement>(".maplibregl-ctrl-zoom-out");
    if (!zoomIn || !zoomOut) return () => {};

    const onZoomIn = (event: MouseEvent) => {
      if (cameraModeRef.current === "fixed") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      animateZoomAroundTrackedPilot(map, 1);
    };
    const onZoomOut = (event: MouseEvent) => {
      if (cameraModeRef.current === "fixed") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      animateZoomAroundTrackedPilot(map, -1);
    };
    zoomIn.addEventListener("click", onZoomIn, { capture: true });
    zoomOut.addEventListener("click", onZoomOut, { capture: true });
    return () => {
      zoomIn.removeEventListener("click", onZoomIn, { capture: true });
      zoomOut.removeEventListener("click", onZoomOut, { capture: true });
    };
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
      dragPan: false,
      dragRotate: false,
      scrollZoom: false,
      attributionControl: { compact: true },
    });
    const removeMouseNavigation = installMouseNavigation(map);
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-left",
    );
    const removeTrackedZoomButtons = installTrackedZoomButtons(map);
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
      const publishTerrainProfile = () => {
        if (terrainProfilePublishedRef.current || !dataRef.current) return;
        if (!map.isSourceLoaded("dem")) return;

        const samples = dataRef.current.samples;
        if (samples.length === 0) return;
        const stride = Math.max(
          1,
          Math.ceil((samples.length - 1) / Math.max(1, MAX_TERRAIN_PROFILE_POINTS - 1)),
        );
        const sampleIndexes: number[] = [];
        for (let index = 0; index < samples.length; index += stride) sampleIndexes.push(index);
        if (sampleIndexes.at(-1) !== samples.length - 1) sampleIndexes.push(samples.length - 1);

        const profile: TerrainProfilePoint[] = [];
        for (const index of sampleIndexes) {
          const sample = samples[index];
          let elevation: number | null = null;
          try {
            elevation = map.queryTerrainElevation([sample[0], sample[1]]);
          } catch {
            elevation = null;
          }
          if (elevation == null || !Number.isFinite(elevation)) continue;
          const rawElevation = elevation / TERRAIN_EXAGGERATION;
          if (rawElevation < -500 || rawElevation > 9_000) continue;
          profile.push([sample[3], rawElevation]);
        }

        // Wait for another idle cycle if the DEM is not yet available along
        // the complete route; gaps would imply false terrain ramps.
        if (profile.length !== sampleIndexes.length) return;
        terrainProfilePublishedRef.current = true;
        onTerrainProfileRef.current?.(profile);
      };
      map.on("idle", anchorToTerrain);
      map.on("idle", publishTerrainProfile);
      anchorToTerrain();
      publishTerrainProfile();
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
      if (styleRefreshTimerRef.current) window.clearInterval(styleRefreshTimerRef.current);
      overlayRef.current = null;
      mapRef.current = null;
      if (trackedZoomAnimationRef.current != null) {
        cancelAnimationFrame(trackedZoomAnimationRef.current);
        trackedZoomAnimationRef.current = null;
      }
      removeTrackedZoomButtons();
      removeMouseNavigation();
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
      // style.load fires before the replacement DEM tiles are ready. Poll for
      // that terrain and rebuild the shadow until it can be projected onto the
      // new surface. Polling also works while an orbiting camera prevents idle.
      let attempts = 0;
      if (styleRefreshTimerRef.current) window.clearInterval(styleRefreshTimerRef.current);
      const refreshForTerrain = () => {
        if (mapRef.current !== map || !map.isStyleLoaded()) return;
        removeShadow(map);
        syncShadow();
        renderLayers(timeRef.current);
        map.triggerRepaint();
        const d = dataRef.current;
        const pos = d ? positionAt(timeRef.current) : null;
        const terrainReady = pos ? groundElevationAt(pos[0], pos[1]) != null : true;
        if (terrainReady || attempts++ >= 40) {
          if (styleRefreshTimerRef.current) window.clearInterval(styleRefreshTimerRef.current);
          styleRefreshTimerRef.current = null;
        }
      };
      styleRefreshTimerRef.current = window.setInterval(refreshForTerrain, 250);
      refreshForTerrain();
    };
    const swap = () => {
      if (styleRefreshTimerRef.current) window.clearInterval(styleRefreshTimerRef.current);
      styleRefreshTimerRef.current = null;
      // MapLibre may preserve custom sources during a style diff while removing
      // their layers. Remove both pieces first so syncShadow recreates a complete
      // terrain-draped line for the incoming map view.
      removeShadow(map);
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
      chasePitchRef.current = CHASE_PITCH;
    }
    if (cameraMode === "fixed" && preserveCameraOnFixedRef.current) {
      preserveCameraOnFixedRef.current = false;
    } else {
      map.setCenterClampedToGround(cameraMode === "fixed");
    }
    if (cameraMode !== "fixed") centerOnGlider(timeRef.current, cameraMode === "chase");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode]);

  // Render the glider at the shared time; follow it with the camera if enabled.
  useEffect(() => {
    timeRef.current = time;
    cameraModeRef.current = cameraMode;
    if (cameraMode !== "fixed" && !suppressFollowRef.current) {
      if (manualCameraInteractionRef.current === "rotate" && mapRef.current) {
        setOrientationAroundTrackedPilot(
          mapRef.current,
          mapRef.current.getBearing(),
          mapRef.current.getPitch(),
        );
      } else if (!cameraTrackingSuspended()) {
        centerOnGlider(time, cameraMode === "chase");
      }
    }
    suppressFollowRef.current = false;
    if (trackDisplayRef.current === "elapsed") syncShadow();
    renderLayers(time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, cameraMode]);

  // Starting or stopping playback is a reliable transport boundary. Rebuild
  // the marker there so any stale perspective scale is corrected immediately,
  // including while paused in a manually panned Fixed view.
  useEffect(() => {
    renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Orbit follows the current pilot position while rotating from wall-clock
  // time. Its 40-second revolution therefore stays constant when playback is
  // paused or its speed changes. A manual left-drag pauses the automatic
  // bearing and resumes from the angle where the user releases it.
  useEffect(() => {
    if (cameraMode !== "orbit") return;
    const map = mapRef.current;
    if (!map) return;
    orbitStateRef.current = {
      bearing: normalizeBearing(map.getBearing()),
      timestamp: performance.now(),
      paused: false,
    };
    let animationFrame = 0;
    const orbit = (now: number) => {
      if (cameraModeRef.current !== "orbit") return;
      const orbitState = orbitStateRef.current;
      if (orbitState && !orbitState.paused) {
        orbitState.bearing = normalizeBearing(
          orbitState.bearing + ((now - orbitState.timestamp) / 40_000) * 360,
        );
        orbitState.timestamp = now;
        if (!cameraTrackingSuspended(now)) {
          centerOnGlider(timeRef.current, false, orbitState.bearing);
        }
      }
      animationFrame = requestAnimationFrame(orbit);
    };
    animationFrame = requestAnimationFrame(orbit);
    return () => {
      cancelAnimationFrame(animationFrame);
      orbitStateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode]);

  useEffect(() => {
    trackDisplayRef.current = trackDisplay;
    displayedTrackCacheRef.current = null;
    syncShadow();
    renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackDisplay, data]);

  useEffect(() => {
    unitsRef.current = units;
    altitudeModeRef.current = altitudeMode;
    renderLayers(timeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, altitudeMode]);

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
      <Card className="flex h-[calc(100vh-430px)] min-h-[420px] max-h-[70vh] items-center justify-center text-gray-500">
        3D replay unavailable.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <div
          ref={containerRef}
          className="flight-replay-map h-[calc(100vh-430px)] min-h-[420px] max-h-[70vh] w-full"
        />
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
