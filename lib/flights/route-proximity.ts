/** Horizontal route proximity on an Earth-centred sphere; altitude is ignored.
 * Recorded segments are indexed in a bounding-volume tree, not compared as a
 * Cartesian product. Short chords also handle the antimeridian and poles.
 */
export type GeoPoint = [number, number]; // longitude, latitude
type V = [number, number, number];
type Segment = { a: V; b: V; min: V; max: V };
type Tree = { min: V; max: V; segments?: Segment[]; left?: Tree; right?: Tree };
const R = 6_371_000;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number) => Math.min(1, Math.max(0, x));
function xyz([lon, lat]: GeoPoint): V {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  return [R * Math.cos(p) * Math.cos(l), R * Math.cos(p) * Math.sin(l), R * Math.sin(p)];
}
function segmentsOf(paths: GeoPoint[][]): Segment[] {
  return paths.flatMap((path) => {
    const points = path.map(xyz);
    return points.map((b, i) => {
      const a = points[Math.max(0, i - 1)];
      return { a, b, min: a.map((v, k) => Math.min(v, b[k])) as V, max: a.map((v, k) => Math.max(v, b[k])) as V };
    });
  });
}
function treeOf(segments: Segment[]): Tree {
  const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
  for (const s of segments) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s.min[k]); max[k] = Math.max(max[k], s.max[k]); }
  if (segments.length <= 12) return { min, max, segments };
  const axis = [0, 1, 2].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]))[0];
  segments.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
  const middle = Math.floor(segments.length / 2);
  return { min, max, left: treeOf(segments.slice(0, middle)), right: treeOf(segments.slice(middle)) };
}
function boxDistance(a: Pick<Tree, "min" | "max">, b: Pick<Tree, "min" | "max">) {
  return [0, 1, 2].reduce((sum, k) => sum + Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]) ** 2, 0);
}
function segmentDistance(a: Segment, b: Segment): number {
  const u = sub(a.b, a.a), v = sub(b.b, b.a), w = sub(a.a, b.a);
  const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), uw = dot(u, w), vw = dot(v, w);
  let s = 0, t = 0;
  if (uu < 1e-12) t = vv < 1e-12 ? 0 : clamp(vw / vv);
  else if (vv < 1e-12) s = clamp(-uw / uu);
  else {
    const denominator = uu * vv - uv * uv;
    s = denominator > 1e-12 ? clamp((uv * vw - uw * vv) / denominator) : 0;
    t = (uv * s + vw) / vv;
    if (t < 0) { t = 0; s = clamp(-uw / uu); }
    else if (t > 1) { t = 1; s = clamp((uv - uw) / uu); }
  }
  const delta = w.map((value, k) => value + s * u[k] - t * v[k]) as V;
  return dot(delta, delta);
}

export function routeProximityIndex(paths: GeoPoint[][]) {
  const root = treeOf(segmentsOf(paths));
  return (other: GeoPoint[][], radiusM = 5_000): number | null => {
    let best = (2 * R * Math.sin(radiusM / (2 * R))) ** 2 + 1e-6;
    let found = false;
    function visit(tree: Tree, segment: Segment) {
      if (boxDistance(tree, segment) > best) return;
      if (tree.segments) {
        for (const s of tree.segments) {
          if (boxDistance(s, segment) > best) continue;
          const distance = segmentDistance(s, segment);
          if (distance <= best) { best = distance; found = true; }
        }
      } else { visit(tree.left!, segment); visit(tree.right!, segment); }
    }
    for (const segment of segmentsOf(other)) visit(root, segment);
    return found ? 2 * R * Math.asin(Math.min(1, Math.sqrt(best) / (2 * R))) : null;
  };
}
