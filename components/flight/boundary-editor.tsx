"use client";

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Undo2, Eraser, Trash2, Save as SaveIcon, Check, X } from "lucide-react";
import { styleFor } from "./basemaps";
import { cn } from "@/lib/utils";
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

/** Every edge of the ring as `{edgeIndex, a, b}` — the edge from vertex `i`
 *  to vertex `(i + 1) % n`, matching insertVertexAt's `afterIndex` contract
 *  exactly. With exactly 2 vertices there's only one physical segment
 *  (traversed once each direction in the closed-ring rendering), so the
 *  second "edge" is skipped to avoid detecting it twice. */
function edgesOf(vertices: readonly LngLat[]): Array<{ edgeIndex: number; a: LngLat; b: LngLat }> {
  const n = vertices.length;
  if (n < 2) return [];
  const edges: Array<{ edgeIndex: number; a: LngLat; b: LngLat }> = [];
  for (let i = 0; i < n; i++) {
    if (n === 2 && i === 1) continue;
    edges.push({ edgeIndex: i, a: vertices[i], b: vertices[(i + 1) % n] });
  }
  return edges;
}

/** Perpendicular distance in screen pixels from point `p` to the segment
 *  `a`-`b`, clamped to the segment (not the infinite line) — used to decide
 *  which edge, if any, a click/drag landed close enough to. */
function distanceToSegmentPx(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const EDGE_INSERT_THRESHOLD_PX = 14;

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

/** The smallest [lon, lat] box containing every given point — used to frame
 *  the initial view on whatever geometry the editor already has (the
 *  existing boundary if there is one, else the reference circle), rather
 *  than always opening at a fixed zoom regardless of the row's actual
 *  size. Returns null for an empty input. */
function boundsOfPoints(points: LngLat[]): [LngLat, LngLat] | null {
  if (points.length === 0) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
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

/** One square icon button in the on-map control stack — sized and styled to
 *  sit visually alongside MapLibre's own NavigationControl buttons (white,
 *  bordered, shadowed) rather than looking like a separate UI system. */
function MapIconButton({
  title,
  icon: Icon,
  onClick,
  disabled,
  variant = "default",
}: {
  title: string;
  icon: typeof Undo2;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded border shadow-sm transition-colors disabled:opacity-40",
        variant === "primary" && "border-ink bg-ink text-paper hover:bg-ink-soft",
        variant === "danger" && "border-gray-300 bg-paper text-red-600 hover:bg-red-50",
        variant === "default" && "border-gray-300 bg-paper text-ink hover:bg-gray-50",
      )}
    >
      <Icon size={16} />
    </button>
  );
}

/** Imperative escape hatch for an embedding context (SiteEditStep) that has
 *  its OWN Save button and wants that single click to also commit any
 *  pending boundary edit, rather than showing a second, confusingly
 *  identical "Save" of its own. */
export interface BoundaryEditorHandle {
  /** Commits the current draft via `onSave` only if it's actually been
   *  touched since load (see `dirtyRef`) — returns null when there's
   *  nothing pending, so the caller can skip its own boundary-specific
   *  error handling entirely in the common case. Returns the literal
   *  "invalid" (not a BoundaryActionOutcome) when the draft is dirty but
   *  fails live client-side validation — that failure is already shown
   *  inline by this component's own error text, so the caller should just
   *  block its own save silently rather than surface a second, duplicate
   *  error banner for the same reason. */
  commitIfDirty(): Promise<BoundaryActionOutcome | null | "invalid">;
}

export const BoundaryEditor = forwardRef<BoundaryEditorHandle, {
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
  /** Overrides the Save button's own text — for an embedding context
   *  (SiteEditStep) that has its own, differently-purposed "Save" button
   *  alongside this one, so the two aren't identically labeled. */
  saveLabel?: string;
  /** Hides this editor's own bottom "Cancel" button — for an embedding
   *  context that already has its own Cancel covering the same action
   *  (onCancel), so the two aren't duplicated on screen. */
  showCancel?: boolean;
  /** Hides this editor's own on-map Save icon — for an embedding context
   *  (SiteEditStep) that drives saving through the imperative handle
   *  instead, so there's only ever one visible "Save" on screen. */
  showSaveButton?: boolean;
}>(function BoundaryEditor(
  {
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
    saveLabel = "Save",
    showCancel = true,
    showSaveButton = true,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vertexMarkersRef = useRef<maplibregl.Marker[]>([]);
  const initialRing: Ring | null = initialBoundary ? { coordinates: initialBoundary.geometry.coordinates[0] } : null;
  const stateRef = useRef<EditorState>(loadEditor(initialRing));
  // True once the pilot has actually changed the draft since mount (any
  // add/move/undo/clear) — distinguishes "nothing to save" from "the
  // pre-existing saved boundary happens to already satisfy canSave" so an
  // unrelated outer Save (e.g. renaming) never silently re-submits an
  // untouched boundary and writes a spurious audit entry.
  const dirtyRef = useRef(false);
  const [, forceRender] = useState(0);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function setState(next: EditorState) {
    stateRef.current = next;
    dirtyRef.current = true;
    forceRender((n) => n + 1);
    syncDrawing();
  }

  /** Push a ring straight to the draft-boundary source with no React
   *  state update and no marker recreation — used to keep the polygon
   *  outline tracking the cursor in real time DURING a drag (native vertex
   *  drag, or the custom edge-insert drag below), where recreating markers
   *  mid-gesture would tear down the very marker being dragged. */
  function updateDraftLine(vertices: readonly LngLat[]) {
    const map = mapRef.current;
    if (!map) return;
    const closed = vertices.length >= 2 ? [...vertices, vertices[0]] : vertices;
    const src = map.getSource("draft-boundary") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(ringGeoJson(closed as LngLat[]));
  }

  function syncDrawing() {
    const map = mapRef.current;
    if (!map) return;
    const vertices = stateRef.current.vertices;

    // Markers are plain DOM overlays, independent of the map's style/source
    // state — they must sync regardless of isStyleLoaded(), which can be
    // transiently false (a real style load can take a moment, and this
    // silently skipping the WHOLE function — vertex markers included, not
    // just the GeoJSON source below — left clicks appearing to do nothing
    // while state had, in fact, updated). The draft-boundary SOURCE is the
    // only part that's actually style-dependent, and updateDraftLine
    // already guards itself via `if (src)`.
    updateDraftLine(vertices);

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
        // Keep the outline tracking the cursor live, not just on release —
        // read straight off the marker (not React state) since the drag
        // hasn't committed yet.
        const { lng, lat: liveLat } = marker.getLngLat();
        const live = stateRef.current.vertices.slice();
        live[index] = [lng, liveLat];
        updateDraftLine(live);
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

    // The real, current zoom/center — exposed as data-* attributes so tests
    // can compute click pixels off the ACTUAL view instead of assuming the
    // fixed construction-time zoom/center, which fitBounds below may move.
    function publishViewState() {
      const el = containerRef.current;
      if (!el) return;
      const c = map.getCenter();
      el.dataset.zoom = String(map.getZoom());
      el.dataset.centerLng = String(c.lng);
      el.dataset.centerLat = String(c.lat);
    }
    publishViewState();
    map.on("moveend", publishViewState);

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

      // Frame the view on whatever geometry already exists — the saved
      // boundary if there is one, else the reference circle — with padding
      // for context, rather than always opening at a fixed zoom regardless
      // of the row's actual size (a boundary drawn much larger than the
      // old circle would otherwise open mostly off-screen).
      const framingRing = initialBoundary
        ? (initialBoundary.geometry.coordinates[0] as LngLat[])
        : referenceRadiusM
          ? circleRing(anchor.lat, anchor.lon, referenceRadiusM)
          : null;
      // No shape yet and no circle to reference (a picker-opened row with
      // neither) — nothing to frame beyond the initial center/zoom already
      // set at map construction.
      if (framingRing) {
        const bounds = boundsOfPoints([...framingRing, [anchor.lon, anchor.lat]]);
        if (bounds) map.fitBounds(bounds, { padding: 56, duration: 0, maxZoom: 17 });
      }
    });

    // A click/drag landing near an existing edge inserts a new vertex right
    // there instead of appending to the end of the list — the vertex only
    // exists once the user actually presses, so nothing is drawn on the
    // edges until then. Handled on plain map mousedown (not a marker) so
    // there's no permanent handle sitting on every edge.
    let edgeInsertHandled = false;
    map.on("mousedown", (ev) => {
      // Pressing an EXISTING vertex must always move that vertex, never
      // insert a new one next to it — a vertex sits exactly on its own two
      // adjacent edges (distance 0), so without this check the proximity
      // test below would treat grabbing a vertex as an edge press too.
      // Checked explicitly by DOM target rather than assumed marker
      // event-propagation behavior, so this holds regardless of it.
      const target = ev.originalEvent.target as HTMLElement | null;
      if (target?.closest('[data-testid="boundary-vertex"]')) return;

      const edges = edgesOf(stateRef.current.vertices);
      if (edges.length === 0) return; // fewer than 2 vertices — nothing to insert on yet

      let bestDist = Infinity;
      let bestEdgeIndex = -1;
      for (const { edgeIndex, a, b } of edges) {
        const d = distanceToSegmentPx(ev.point, map.project(a), map.project(b));
        if (d < bestDist) {
          bestDist = d;
          bestEdgeIndex = edgeIndex;
        }
      }
      if (bestEdgeIndex === -1 || bestDist > EDGE_INSERT_THRESHOLD_PX) return;

      edgeInsertHandled = true;
      ev.preventDefault();
      map.dragPan.disable();
      const newIndex = bestEdgeIndex + 1;
      setState(insertVertexAt(stateRef.current, bestEdgeIndex, ev.lngLat.lng, ev.lngLat.lat));

      const onMove = (moveEv: maplibregl.MapMouseEvent) => {
        const marker = vertexMarkersRef.current[newIndex];
        if (marker) marker.setLngLat(moveEv.lngLat);
        const live = stateRef.current.vertices.slice();
        live[newIndex] = [moveEv.lngLat.lng, moveEv.lngLat.lat];
        updateDraftLine(live);
      };
      const onUp = (upEv: maplibregl.MapMouseEvent) => {
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        map.dragPan.enable();
        setState(moveVertex(stateRef.current, newIndex, upEv.lngLat.lng, upEv.lngLat.lat));
      };
      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
    });

    map.on("click", (ev) => {
      if (edgeInsertHandled) {
        edgeInsertHandled = false;
        return; // already handled by the mousedown-driven edge insert above
      }
      setState(addVertex(stateRef.current, ev.lngLat.lng, ev.lngLat.lat));
    });

    return () => {
      for (const m of vertexMarkersRef.current) m.remove();
      vertexMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = liveValidate(stateRef.current, level, anchor);
  const canSave = stateRef.current.vertices.length >= 3 && live.result === null;
  const errorCopy = live.result && !live.result.ok ? ERROR_COPY[live.result.error] ?? "That shape isn't valid." : null;

  async function commitDraft(): Promise<BoundaryActionOutcome> {
    setSaving(true);
    setActionError(null);
    const closed = [...stateRef.current.vertices, stateRef.current.vertices[0]];
    const raw = { type: "Polygon" as const, coordinates: [closed] };
    const result = await onSave(raw);
    setSaving(false);
    if (result.ok) {
      dirtyRef.current = false;
      onSaved?.();
    } else {
      setActionError(result.error);
    }
    return result;
  }

  async function handleSave() {
    if (!canSave) return;
    await commitDraft();
  }

  useImperativeHandle(ref, () => ({
    async commitIfDirty() {
      if (!dirtyRef.current) return null;
      if (!canSave) return "invalid";
      return commitDraft();
    },
  }));

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

  const hasVertices = stateRef.current.vertices.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div ref={containerRef} data-testid="boundary-editor-map" className="h-[520px] w-full rounded-lg" />
        {/* On-map control stack, right below MapLibre's own zoom buttons
         *  (top-right) — icons instead of the old below-map text row, which
         *  crowded awkwardly against this component's embedding contexts'
         *  own bottom action rows. */}
        <div className="absolute right-[10px] top-[84px] z-10 flex flex-col items-end gap-1.5">
          <MapIconButton
            title="Undo last point"
            icon={Undo2}
            onClick={() => setState(undoLastVertex(stateRef.current))}
            disabled={!hasVertices || saving}
          />
          {confirmingClear ? (
            <div className="flex gap-1.5">
              <MapIconButton
                title="Yes, clear"
                icon={Check}
                variant="danger"
                onClick={() => {
                  setState(clearEditor());
                  setConfirmingClear(false);
                }}
              />
              <MapIconButton title="Cancel" icon={X} onClick={() => setConfirmingClear(false)} />
            </div>
          ) : (
            <MapIconButton
              title="Clear"
              icon={Eraser}
              onClick={() => setConfirmingClear(true)}
              disabled={!hasVertices || saving}
            />
          )}
          {initialBoundary &&
            (confirmingRemove ? (
              <div className="flex gap-1.5">
                <MapIconButton title="Yes, remove boundary" icon={Check} variant="danger" onClick={handleClear} disabled={saving} />
                <MapIconButton title="Cancel" icon={X} onClick={() => setConfirmingRemove(false)} />
              </div>
            ) : (
              <MapIconButton title="Remove boundary" icon={Trash2} onClick={() => setConfirmingRemove(true)} disabled={saving} />
            ))}
          {showSaveButton && (
            <MapIconButton
              title={saving ? "Saving…" : saveLabel}
              icon={SaveIcon}
              variant="primary"
              onClick={handleSave}
              disabled={!canSave || saving}
            />
          )}
        </div>
      </div>
      {initialBoundary && (
        <p className="text-xs text-neutral-500">
          <span className="inline-block h-0 w-3 border-t-2 border-dashed border-[#3b7dd8] align-middle" /> dashed blue
          — the currently saved boundary
        </p>
      )}
      {errorCopy && <p className="text-sm font-medium text-red-600">{errorCopy}</p>}
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      {showCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="self-start rounded border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Cancel
        </button>
      )}
    </div>
  );
});

