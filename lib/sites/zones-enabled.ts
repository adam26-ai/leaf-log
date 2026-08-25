/**
 * SPRINT-008 zone visibility gate: ZONES_ENABLED=true re-enables zones;
 * absent or any other value means zones are hidden from the product
 * surface. Read fresh (never cached at module load) so it's testable and
 * flippable without a redeploy — the same operational shape as
 * lib/sites/lookup.ts's boundaryMatchingEnabled(). This is a HIDE, not a
 * delete: the Zone table, Flight's zone columns, and every zone-aware code
 * path stay exactly as they are — only reachability changes.
 */
export function zonesEnabled(): boolean {
  return process.env.ZONES_ENABLED === "true";
}
