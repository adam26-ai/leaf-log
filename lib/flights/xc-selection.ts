import { readXcScore, type XcShape } from "@/lib/igc/xc-types";

/** One route per scoring category, starting with the winning score. */
export function replayXcRoutes(value: unknown) {
  const score = readXcScore(value);
  if (!score) return [];
  const seen = new Set<XcShape>();
  return [score.best, ...score.candidates].filter(route => {
    if (seen.has(route.shape) || route.distanceM <= 0 || !route.vertices?.length) return false;
    seen.add(route.shape);
    return true;
  });
}

export function nextXcShape(value: unknown, current: XcShape | null): XcShape | null {
  const routes = replayXcRoutes(value);
  return routes[current == null ? 0 : routes.findIndex(route => route.shape === current) + 1]?.shape ?? null;
}
