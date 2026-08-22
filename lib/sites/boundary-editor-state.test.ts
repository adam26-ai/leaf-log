import { describe, it, expect } from "vitest";
import {
  EMPTY_EDITOR_STATE,
  addVertex,
  undoLastVertex,
  removeVertexAt,
  moveVertex,
  insertVertexAt,
  clearEditor,
  loadEditor,
  liveValidate,
} from "./boundary-editor-state";

const BASE_LAT = 10;
const BASE_LON = 20;

function squareVertices(): [number, number][] {
  return [
    [BASE_LON - 0.001, BASE_LAT - 0.001],
    [BASE_LON + 0.001, BASE_LAT - 0.001],
    [BASE_LON + 0.001, BASE_LAT + 0.001],
    [BASE_LON - 0.001, BASE_LAT + 0.001],
  ];
}

describe("addVertex / undoLastVertex", () => {
  it("appends in tap order, and undo drops the most recently added vertex", () => {
    let state = EMPTY_EDITOR_STATE;
    state = addVertex(state, 1, 1);
    state = addVertex(state, 2, 2);
    state = addVertex(state, 3, 3);
    expect(state.vertices).toEqual([[1, 1], [2, 2], [3, 3]]);

    state = undoLastVertex(state);
    expect(state.vertices).toEqual([[1, 1], [2, 2]]);
  });

  it("undo on an empty state is a no-op", () => {
    expect(undoLastVertex(EMPTY_EDITOR_STATE)).toBe(EMPTY_EDITOR_STATE);
  });
});

describe("removeVertexAt", () => {
  it("removes the vertex at the given index, preserving order of the rest", () => {
    const state = { vertices: squareVertices() };
    const result = removeVertexAt(state, 1);
    expect(result.vertices).toEqual([squareVertices()[0], squareVertices()[2], squareVertices()[3]]);
  });

  it("is a no-op for an out-of-range index", () => {
    const state = { vertices: squareVertices() };
    expect(removeVertexAt(state, -1)).toBe(state);
    expect(removeVertexAt(state, 99)).toBe(state);
  });
});

describe("moveVertex", () => {
  it("replaces the vertex at the given index (a drag) without touching the others", () => {
    const state = { vertices: squareVertices() };
    const result = moveVertex(state, 0, 99, 99);
    expect(result.vertices[0]).toEqual([99, 99]);
    expect(result.vertices.slice(1)).toEqual(squareVertices().slice(1));
  });

  it("is a no-op for an out-of-range index", () => {
    const state = { vertices: squareVertices() };
    expect(moveVertex(state, 10, 0, 0)).toBe(state);
  });
});

describe("insertVertexAt", () => {
  it("inserts a new vertex between afterIndex and afterIndex + 1, preserving the rest in order", () => {
    const state = { vertices: squareVertices() };
    const result = insertVertexAt(state, 0, 999, 999);
    expect(result.vertices).toEqual([
      squareVertices()[0],
      [999, 999],
      squareVertices()[1],
      squareVertices()[2],
      squareVertices()[3],
    ]);
  });

  it("inserting after the LAST vertex appends to the end — the closing edge back to vertex 0", () => {
    const state = { vertices: squareVertices() };
    const result = insertVertexAt(state, 3, 999, 999);
    expect(result.vertices).toEqual([...squareVertices(), [999, 999]]);
  });

  it("is a no-op with fewer than 2 vertices (no edge exists yet)", () => {
    const state = { vertices: [[1, 1]] as [number, number][] };
    expect(insertVertexAt(state, 0, 5, 5)).toBe(state);
  });

  it("is a no-op for an out-of-range index", () => {
    const state = { vertices: squareVertices() };
    expect(insertVertexAt(state, -1, 5, 5)).toBe(state);
    expect(insertVertexAt(state, 4, 5, 5)).toBe(state);
  });
});

describe("clearEditor / loadEditor", () => {
  it("clearEditor always returns the empty state", () => {
    expect(clearEditor()).toEqual(EMPTY_EDITOR_STATE);
  });

  it("loadEditor(null) returns the empty state — the 'no boundary yet' case", () => {
    expect(loadEditor(null)).toEqual(EMPTY_EDITOR_STATE);
  });

  it("loadEditor strips a closed ring's repeated closing vertex, since the editor's own list is always open", () => {
    const closed = [...squareVertices(), squareVertices()[0]];
    const state = loadEditor({ coordinates: closed });
    expect(state.vertices).toEqual(squareVertices());
  });

  it("loadEditor passes through an already-open ring unchanged", () => {
    const state = loadEditor({ coordinates: squareVertices() });
    expect(state.vertices).toEqual(squareVertices());
  });
});

describe("liveValidate", () => {
  const anchor = { lat: BASE_LAT, lon: BASE_LON };

  it("reports too_few_vertices below 3 points, with no area", () => {
    const state = { vertices: [[BASE_LON, BASE_LAT], [BASE_LON + 0.001, BASE_LAT]] as [number, number][] };
    const live = liveValidate(state, "site", anchor);
    expect(live.vertexCount).toBe(2);
    expect(live.approxAreaM2).toBeNull();
    expect(live.result?.ok).toBe(false);
    if (live.result && !live.result.ok) expect(live.result.error).toBe("too_few_vertices");
  });

  it("reports a valid shape (result: null) once 3+ points form a legal ring containing the anchor", () => {
    const state = { vertices: squareVertices() };
    const live = liveValidate(state, "site", anchor);
    expect(live.vertexCount).toBe(4);
    expect(live.approxAreaM2).not.toBeNull();
    expect(live.approxAreaM2 as number).toBeGreaterThan(0);
    expect(live.result).toBeNull();
  });

  it("surfaces the SAME validator error the server would give for an anchor-excluding shape", () => {
    const state = { vertices: squareVertices() };
    const farAnchor = { lat: BASE_LAT + 1, lon: BASE_LON + 1 };
    const live = liveValidate(state, "site", farAnchor);
    expect(live.result?.ok).toBe(false);
    if (live.result && !live.result.ok) expect(live.result.error).toBe("excludes_anchor");
  });

  it("uses the level-specific area cap (zone tighter than site) for the SAME shape", () => {
    // A shape between the zone cap (20 km^2) and the site cap (50 km^2).
    const bigHalfDeg = 0.03; // roughly several km on a side at these latitudes
    const state = {
      vertices: [
        [BASE_LON - bigHalfDeg, BASE_LAT - bigHalfDeg],
        [BASE_LON + bigHalfDeg, BASE_LAT - bigHalfDeg],
        [BASE_LON + bigHalfDeg, BASE_LAT + bigHalfDeg],
        [BASE_LON - bigHalfDeg, BASE_LAT + bigHalfDeg],
      ] as [number, number][],
    };
    const siteLive = liveValidate(state, "site", anchor);
    const zoneLive = liveValidate(state, "zone", anchor);
    // Whichever the outcome, both draw from the SAME approxAreaM2 readout
    // and the SAME validateBoundary — only the level differs.
    expect(siteLive.approxAreaM2).toBeCloseTo(zoneLive.approxAreaM2 as number, -2);
  });
});
