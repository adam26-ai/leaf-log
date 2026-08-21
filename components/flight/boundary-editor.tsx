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

export function BoundaryEditor({
  anchor,
  initialBoundary,
  level,
  referenceRadiusM,
  parent = null,
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
  onSave: (raw: unknown) => Promise<BoundaryActionOutcome>;
  onClear: () => Promise<BoundaryActionOutcome>;
  onCancel: () => void;
  onSaved?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vertexMarkersRef = useRef<maplibregl.Marker[]>([]);
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
    if (!map || !map.isStyleLoaded()) return;
    const vertices = stateRef.current.vertices;
    const closed = vertices.length >= 2 ? [...vertices, vertices[0]] : vertices;

    const src = map.getSource("draft-boundary") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(ringGeoJson(closed as LngLat[]));

    for (const m of vertexMarkersRef.current) m.remove();
    vertexMarkersRef.current = vertices.map(([lon, lat], index) => {
      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;border-radius:50%;background:#ffb459;border:2px solid #141414;cursor:pointer;box-sizing:border-box;";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setState(removeVertexAt(stateRef.current, index));
      });
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map);
      marker.on("dragend", () => {
        const { lng, lat: newLat } = marker.getLngLat();
        setState(moveVertex(stateRef.current, index, lng, newLat));
      });
      return marker;
    });
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor("monochrome"), // keyless — the editor must work with no MapTiler key
      center: [anchor.lon, anchor.lat],
      zoom: 15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      new maplibregl.Marker({ color: "#272727" }).setLngLat([anchor.lon, anchor.lat]).addTo(map);

      if (referenceRadiusM) {
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

