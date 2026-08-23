/**
 * The boundary editor's state machine — vertex list, undo, and live
 * validation — deliberately separated from components/flight/
 * boundary-editor.tsx's MapLibre rendering shell so it's testable under
 * jsdom (which has no WebGL) rather than only aspirationally "tested where
 * practical." No DOM, no MapLibre, no Next imports — pure, like the rest of
 * lib/sites/.
 */
import { validateBoundary, type BoundaryLevel, type BoundaryValidationResult } from "./boundary";
import { ringAreaM2, type Ring } from "./geo";

export interface EditorState {
  /** [lon, lat] pairs, in the order tapped — insertion order IS the undo
   *  history, so "undo last point" is just dropping the last element. */
  readonly vertices: readonly [number, number][];
}

export const EMPTY_EDITOR_STATE: EditorState = { vertices: [] };

export function addVertex(state: EditorState, lon: number, lat: number): EditorState {
  return { vertices: [...state.vertices, [lon, lat]] };
}

export function undoLastVertex(state: EditorState): EditorState {
  if (state.vertices.length === 0) return state;
  return { vertices: state.vertices.slice(0, -1) };
}

export function removeVertexAt(state: EditorState, index: number): EditorState {
  if (index < 0 || index >= state.vertices.length) return state;
  return { vertices: state.vertices.filter((_, i) => i !== index) };
}

export function moveVertex(state: EditorState, index: number, lon: number, lat: number): EditorState {
  if (index < 0 || index >= state.vertices.length) return state;
  const vertices = state.vertices.slice();
  vertices[index] = [lon, lat];
  return { vertices };
}

/**
 * Insert a new vertex on the edge immediately after `afterIndex` — i.e.
 * between vertex `afterIndex` and vertex `afterIndex + 1` (wrapping: the
 * edge after the LAST vertex is the closing edge back to vertex 0, and
 * inserting there appends to the end, which is exactly correct for a
 * closed ring). This is what backs "click or drag a point on an edge to
 * add a new vertex there and reshape the polygon."
 */
export function insertVertexAt(state: EditorState, afterIndex: number, lon: number, lat: number): EditorState {
  const n = state.vertices.length;
  if (n < 2 || afterIndex < 0 || afterIndex >= n) return state;
  const vertices = state.vertices.slice();
  vertices.splice(afterIndex + 1, 0, [lon, lat]);
  return { vertices };
}

export function clearEditor(): EditorState {
  return EMPTY_EDITOR_STATE;
}

export function loadEditor(ring: Ring | null): EditorState {
  if (!ring) return EMPTY_EDITOR_STATE;
  // Drop the closing repeat — the editor's own vertex list is always OPEN;
  // validateBoundary closes it again on save.
  const pts = ring.coordinates;
  const open = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
  return { vertices: open.map(([lon, lat]) => [lon, lat] as [number, number]) };
}

export interface LiveValidation {
  vertexCount: number;
  /** Only meaningful once vertexCount >= 3 — a rough live readout, not a
   *  substitute for the real validateBoundary check at save time. */
  approxAreaM2: number | null;
  /** The first failing rule, from the SAME validateBoundary the server
   *  uses — so the live readout and the save-time authority can never
   *  disagree about what "invalid" means. Null once the shape is valid. */
  result: BoundaryValidationResult | null;
}

/**
 * Live feedback while drawing, via the identical pure validator the server
 * uses (imported, not re-implemented) — so an invalid shape is visible
 * DURING drawing, not only rejected on save.
 */
export function liveValidate(
  state: EditorState,
  level: BoundaryLevel,
  anchor: { lat: number; lon: number },
): LiveValidation {
  const vertexCount = state.vertices.length;
  if (vertexCount < 3) {
    return { vertexCount, approxAreaM2: null, result: { ok: false, error: "too_few_vertices" } };
  }

  const closed: [number, number][] = [...state.vertices, state.vertices[0]];
  const approxAreaM2 = ringAreaM2({ coordinates: closed });
  const raw = { type: "Polygon" as const, coordinates: [closed] };
  const result = validateBoundary(raw, level, anchor);
  return { vertexCount, approxAreaM2, result: result.ok ? null : result };
}
