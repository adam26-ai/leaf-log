"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor } from "./basemaps";
import type { Boundary, Ring } from "@/lib/sites/geo";
import type { BoundaryLevel } from "@/lib/sites/boundary";
import {
  addVertex,
  undoLastVertex,
  removeVertexAt,
  moveVertex,
  insertVertexAt,
  clearEditor,
  loadEditor,
  liveValidate,
  type EditorState,
} from "@/lib/sites/boundary-editor-state";

type LngLat = [number, number];

const ERROR_COPY: Record<string, string> = {
  malformed: "That shape isn't valid.",
  unsupported_version: "That shape isn't valid.",
  too_few_vertices: "Add at least 3 points.",
  too_many_vertices: "Too many points — simplify the shape.",
  coordinate_out_of_range: "That shape isn't valid.",
  crosses_antimeridian: "That shape spans too much of the globe.",
  self_intersecting: "The outline crosses itself.",
  degenerate: "That area is too small.",
  too_large: "That area is too large.",
  excludes_anchor: "The shape has to include the site's own location.",
};

function ringGeoJson(coords: LngLat[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [coords] },
  };
}

/** One midpoint handle per edge of the ring — the edge from vertex `i` to
 *  vertex `(i + 1) % n`, matching insertVertexAt's `afterIndex` contract
 *  exactly. With exactly 2 vertices there's only one physical segment
 *  (traversed once each direction in the closed-ring rendering), so the
 *  second "edge" is skipped to avoid two overlapping handles. */
function computeMidpoints(
  vertices: readonly [number, number][],
): Array<{ edgeIndex: number; lon: number; lat: number }> {
  const n = vertices.length;
  if (n < 2) return [];
  const midpoints: Array<{ edgeIndex: number; lon: number; lat: number }> = [];
  for (let i = 0; i < n; i++) {
    if (n === 2 && i === 1) continue;
    const [aLon, aLat] = vertices[i];
    const [bLon, bLat] = vertices[(i + 1) % n];
    midpoints.push({ edgeIndex: i, lon: (aLon + bLon) / 2, lat: (aLat + bLat) / 2 });
  }
  return midpoints;
}

function circleRing(lat: number, lon: number, radiusM: number, steps = 48): LngLat[] {
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * cosLat);
  const pts: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    pts.push([lon + Math.sin(angle) * dLon, lat + Math.cos(angle) * dLat]);
  }
  return pts;
}

export interface BoundaryEditorContext {
  anchor: { lat: number; lon: number };
  radiusM?: number;
  boundary?: Boundary | null;
}

export type BoundaryActionOutcome = { ok: true } | { ok: false; error: string };

export interface NearbyContextItem {
  lat: number;
  lon: number;
  radiusM: number;
}

export function BoundaryEditor({
  anchor,
  initialBoundary,
  level,
  referenceRadiusM,
  parent = null,
  nearby = [],
  onSave,
  onClear,
  onCancel,
  onSaved,
}: {
  anchor: { lat: number; lon: number };
  initialBoundary: Boundary | null;
  level: BoundaryLevel;
  /** The circle this boundary would replace, drawn as a dashed reference
   *  ring so the pilot sees what they're changing. */
  referenceRadiusM?: number;
  /** When editing a zone, the parent site's geometry — drawn faintly as
   *  CONTEXT, never enforced (a zone may legally extend past it). */
  parent?: BoundaryEditorContext | null;
  /** Other visible sites/zones near the anchor, drawn as faint reference
   *  circles — context for a pilot about to draw something large, since
   *  zone boundaries are deliberately not capped near the old circle
   *  scale (see docs/sprints/SPRINT-006.md's Risks). */
  nearby?: NearbyContextItem[];
  onSave: (raw: unknown) => Promise<BoundaryActionOutcome>;
  onClear: () => Promise<BoundaryActionOutcome>;
  onCancel: () => void;
  onSaved?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vertexMarkersRef = useRef<maplibregl.Marker[]>([]);
  const midpointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const initialRing: Ring | null = initialBoundary ? { coordinates: initialBoundary.geometry.coordinates[0] } : null;
  const stateRef = useRef<EditorState>(loadEditor(initialRing));
  const [, forceRender] = useState(0);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function setState(next: EditorState) {
    stateRef.current = next;
    forceRender((n) => n + 1);
    syncDrawing();
  }

  function syncDrawing() {
    const map = mapRef.current;
    if (!map) return;
    const vertices = stateRef.current.vertices;
    const closed = vertices.length >= 2 ? [...vertices, vertices[0]] : vertices;

    // Markers are plain DOM overlays, independent of the map's style/source
    // state — they must sync regardless of isStyleLoaded(), which can be
    // transiently false (a real style load can take a moment, and this
    // silently skipping the WHOLE function — vertex/midpoint markers
    // included, not just the GeoJSON source below — left clicks appearing
    // to do nothing while state had, in fact, updated). The draft-boundary
    // SOURCE is the only part that's actually style-dependent, and it
    // already guards itself via `if (src)`.
    const src = map.getSource("draft-boundary") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(ringGeoJson(closed as LngLat[]));

    for (const m of vertexMarkersRef.current) m.remove();
    vertexMarkersRef.current = vertices.map(([lon, lat], index) => {
      const el = document.createElement("div");
      el.dataset.testid = "boundary-vertex";
      el.dataset.vertexIndex = String(index);
      el.style.cssText =
        "width:18px;height:18px;border-radius:50%;background:#ffb459;border:2px solid #141414;cursor:pointer;box-sizing:border-box;";
      // A native 'click' fires after mouseup on the same element regardless
      // of how far the pointer travelled in between — so a real drag would
      // ALSO fire 'click' right after 'dragend' unless we distinguish them.
      let dragged = false;
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map);
      marker.on("dragstart", () => {
        dragged = false;
      });
      marker.on("drag", () => {
        dragged = true;
      });
      marker.on("dragend", () => {
        if (!dragged) return; // a click-without-movement fires dragend too in some browsers
        const { lng, lat: newLat } = marker.getLngLat();
        setState(moveVertex(stateRef.current, index, lng, newLat));
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (dragged) {
          dragged = false;
          return; // already handled by dragend — tapping a point removes it, dragging moves it
        }
        setState(removeVertexAt(stateRef.current, index));
      });
      return marker;
    });

    for (const m of midpointMarkersRef.current) m.remove();
    midpointMarkersRef.current = computeMidpoints(vertices).map(({ edgeIndex, lon, lat }) => {
      const el = document.createElement("div");
      el.dataset.testid = "boundary-midpoint";
      el.dataset.edgeIndex = String(edgeIndex);
      el.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#ffe0ba;border:2px solid #ffb459;cursor:copy;box-sizing:border-box;opacity:0.85;";
      // A native 'click' fires after mouseup on the same element regardless
      // of movement, and MapLibre's draggable Marker fires dragstart/dragend
      // even for a zero-movement press in some browsers — `dragged` is what
      // keeps a plain click from ALSO triggering dragend's insert (a double
      // insert at (almost) the same spot for one tap).
      let dragged = false;
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map);
      // Dragging a midpoint inserts a new vertex there and lets it follow
      // the cursor for the rest of the gesture (MapLibre's draggable
      // Marker already tracks the pointer on its own) — the insert only
      // commits to state on release, so the marker being dragged is never
      // destroyed mid-gesture by a re-render.
      marker.on("dragstart", () => {
        dragged = false;
      });
      marker.on("drag", () => {
        dragged = true;
      });
      marker.on("dragend", () => {
        if (!dragged) return; // a click-without-movement fires dragend too in some browsers
        const { lng, lat: newLat } = marker.getLngLat();
        setState(insertVertexAt(stateRef.current, edgeIndex, lng, newLat));
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (dragged) {
          dragged = false;
          return; // already handled by dragend
        }
        setState(insertVertexAt(stateRef.current, edgeIndex, lon, lat));
      });
      return marker;
    });
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Satellite imagery — drawing a boundary needs to see the actual
      // ridge/bowl/launch pad, not a plain map. styleFor() falls back to
      // the keyless monochrome style when NEXT_PUBLIC_MAPTILER_KEY isn't
      // set, so the editor still works with no key — just without imagery.
      style: styleFor("satellite"),
      center: [anchor.lon, anchor.lat],
      zoom: 15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      new maplibregl.Marker({ color: "#272727" }).setLngLat([anchor.lon, anchor.lat]).addTo(map);

      if (initialBoundary) {
        // A row that already has a boundary is being replaced by whatever
        // gets saved next, not by the circle — show the CURRENTLY SAVED
        // shape as a static dashed reference, distinct from the live
        // (orange, editable) draft, so editing/dragging points never loses
        // sight of what's actually live right now.
        map.addSource("current-boundary", {
          type: "geojson",
          data: ringGeoJson(initialBoundary.geometry.coordinates[0] as LngLat[]),
        });
        map.addLayer({
          id: "current-boundary-line",
          type: "line",
          source: "current-boundary",
          paint: { "line-color": "#3b7dd8", "line-width": 2, "line-dasharray": [2, 2] },
        });
      } else if (referenceRadiusM) {
        map.addSource("reference-circle", {
          type: "geojson",
          data: ringGeoJson(circleRing(anchor.lat, anchor.lon, referenceRadiusM)),
        });
        map.addLayer({
          id: "reference-circle-line",
          type: "line",
          source: "reference-circle",
          paint: { "line-color": "#8a8a8a", "line-width": 2, "line-dasharray": [2, 2] },
        });
      }

      if (parent) {
        const parentRing = parent.boundary
          ? parent.boundary.geometry.coordinates[0]
          : parent.radiusM
            ? circleRing(parent.anchor.lat, parent.anchor.lon, parent.radiusM)
            : null;
        if (parentRing) {
          map.addSource("parent-geometry", { type: "geojson", data: ringGeoJson(parentRing as LngLat[]) });
          map.addLayer({
            id: "parent-geometry-line",
            type: "line",
            source: "parent-geometry",
            paint: { "line-color": "#6fae5e", "line-width": 1.5, "line-dasharray": [1, 2] },
          });
        }
      }

      if (nearby.length > 0) {
        map.addSource("nearby-context", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: nearby.map((n) => ringGeoJson(circleRing(n.lat, n.lon, n.radiusM))),
          },
        });
        map.addLayer({
          id: "nearby-context-line",
          type: "line",
          source: "nearby-context",
          paint: { "line-color": "#b0b0b0", "line-width": 1, "line-dasharray": [1, 3] },
        });
      }

      map.addSource("draft-boundary", { type: "geojson", data: ringGeoJson([]) });
      map.addLayer({
        id: "draft-boundary-fill",
        type: "fill",
        source: "draft-boundary",
        paint: { "fill-color": "#ffb459", "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "draft-boundary-line",
        type: "line",
        source: "draft-boundary",
        paint: { "line-color": "#ffb459", "line-width": 2 },
      });

      syncDrawing();
    });

    map.on("click", (ev) => {
      setState(addVertex(stateRef.current, ev.lngLat.lng, ev.lngLat.lat));
    });

    return () => {
      for (const m of vertexMarkersRef.current) m.remove();
      vertexMarkersRef.current = [];
      for (const m of midpointMarkersRef.current) m.remove();
      midpointMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = liveValidate(stateRef.current, level, anchor);
  const canSave = stateRef.current.vertices.length >= 3 && live.result === null;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setActionError(null);
    const closed = [...stateRef.current.vertices, stateRef.current.vertices[0]];
    const raw = { type: "Polygon" as const, coordinates: [closed] };
    const result = await onSave(raw);
    setSaving(false);
    if (result.ok) onSaved?.();
    else setActionError(result.error);
  }

  async function handleClear() {
    setSaving(true);
    setActionError(null);
    const result = await onClear();
    setSaving(false);
    if (result.ok) {
      setState(clearEditor());
      setConfirmingRemove(false);
      onSaved?.();
    } else {
      setActionError(result.error);
    }
  }

  const errorCopy = live.result && !live.result.ok ? ERROR_COPY[live.result.error] ?? "That shape isn't valid." : null;

  return (
    <div className="flex flex-col gap-3">
      <div ref={containerRef} data-testid="boundary-editor-map" className="h-[360px] w-full rounded-lg" />
      {initialBoundary && (
        <p className="text-xs text-neutral-500">
          <span className="inline-block h-0 w-3 border-t-2 border-dashed border-[#3b7dd8] align-middle" /> dashed blue
          — the currently saved boundary
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span>{live.vertexCount} point{live.vertexCount === 1 ? "" : "s"}</span>
        {live.approxAreaM2 != null && (
          <span>
            &middot; ~{live.approxAreaM2 >= 1_000_000 ? `${(live.approxAreaM2 / 1_000_000).toFixed(2)} km²` : `${Math.round(live.approxAreaM2)} m²`}
          </span>
        )}
        {errorCopy && <span className="font-medium text-red-600">&middot; {errorCopy}</span>}
      </div>
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setState(undoLastVertex(stateRef.current))}
          disabled={stateRef.current.vertices.length === 0 || saving}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Undo last point
        </button>
        {confirmingClear ? (
          <>
            <span className="text-sm text-neutral-600">Clear the drawing?</span>
            <button
              type="button"
              onClick={() => {
                setState(clearEditor());
                setConfirmingClear(false);
              }}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600"
            >
              Yes, clear
            </button>
            <button type="button" onClick={() => setConfirmingClear(false)} className="rounded border px-3 py-1.5 text-sm">
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            disabled={stateRef.current.vertices.length === 0 || saving}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {initialBoundary &&
          (confirmingRemove ? (
            <>
              <span className="text-sm text-neutral-600">Remove this boundary? Matching goes back to the default circle.</span>
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600"
              >
                Yes, remove
              </button>
              <button type="button" onClick={() => setConfirmingRemove(false)} className="rounded border px-3 py-1.5 text-sm">
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              disabled={saving}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Remove boundary
            </button>
          ))}
        <button type="button" onClick={onCancel} disabled={saving} className="rounded border px-3 py-1.5 text-sm disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  );
}

