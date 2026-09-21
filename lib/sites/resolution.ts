import { haversineM } from "@/lib/geo/distance";
import { kindMatches, locationMatches, radiusForKind } from "./geo";
import { normalizeName, validateSiteName } from "./name";
import { hasSitePoint, newSiteDraft, type SiteDraft, type SitePoint } from "./model";

export type SiteCandidate = {
  id: string; name: string; normalizedName: string; lat: number | null; lon: number | null;
  kind: string; visibility: string; ownerId: string | null; boundary: unknown; updatedAt: Date;
};
export type EndpointInput = {
  key: string; endpoint: "takeoff" | "landing"; name: string; lat: number | null; lon: number | null;
  siteId?: string; draft?: SiteDraft; cleared?: boolean; evidenceOnly?: boolean;
};
export type SiteResolution = {
  key: string; name: string | null; siteId: string | null; groupKey: string | null;
  outcome: "existing" | "mapped" | "unmapped" | "review" | "none";
  reason: string | null; draft?: SiteDraft;
};
export type SitePlan = { resolutions: SiteResolution[]; groups: Array<{ key: string; draft: SiteDraft }> };

export const IMPORT_CLUSTER_DIAMETER_M = { takeoff: 150, landing: 300 } as const;

/** One policy for previews and commits. Candidates have already been viewer-scoped. */
export function planSites(inputs: EndpointInput[], candidates: SiteCandidate[], ownerId: string): SitePlan {
  const byId = new Map(candidates.map(site => [site.id, site]));
  const enrichmentChecks = new Map<string, boolean>();
  const groups: Array<{ key: string; draft: SiteDraft; points: SitePoint[]; normalized: string; endpoint: EndpointInput["endpoint"]; review: boolean }> = [];
  const resolutions: SiteResolution[] = [];
  for (const input of inputs) {
    if (input.evidenceOnly) continue;
    const name = normalizeName(input.name);
    const valid = validateSiteName(name);
    const base = { key: input.key, name: name || null, siteId: null, groupKey: null, reason: null };
    if (input.cleared && !input.siteId && !input.draft && !name) { resolutions.push({ ...base, outcome: "none" }); continue; }
    if (input.draft) {
      const key = input.draft.id ? `edit:${input.draft.id}` : `draft:${JSON.stringify(input.draft)}`;
      const existing = groups.find(group => group.key === key);
      if (existing && JSON.stringify(existing.draft) !== JSON.stringify(input.draft)) throw new Error("The same site has different pending edits. Use one version before saving.");
      if (!existing) groups.push({ key, draft: input.draft, points: [], normalized: "", endpoint: input.endpoint, review: false });
      resolutions.push({ ...base, groupKey: key, outcome: hasSitePoint(input.draft) ? "mapped" : "unmapped", draft: input.draft });
      continue;
    }
    if (input.siteId) {
      const selected = byId.get(input.siteId);
      if (!selected) throw new Error("A selected site is no longer available. Choose it again before saving.");
      if (!hasSitePoint(selected) && selected.ownerId === ownerId && hasSitePoint(input)) {
        if (!enrichmentChecks.has(selected.id)) {
          const observations = [...new Map(inputs.filter(other => other.siteId === selected.id && !other.draft && hasSitePoint(other))
            .map(other => [`${other.endpoint}:${other.lat}:${other.lon}`, other])).values()];
          enrichmentChecks.set(selected.id, observations.every((a, index) => observations.slice(index + 1).every(b =>
            haversineM(a.lat!, a.lon!, b.lat!, b.lon!) <= Math.min(IMPORT_CLUSTER_DIAMETER_M[a.endpoint], IMPORT_CLUSTER_DIAMETER_M[b.endpoint]))));
        }
        const coherent = enrichmentChecks.get(selected.id)!;
        if (coherent) {
          const key = 'enrich:' + selected.id;
          if (!groups.some(group => group.key === key)) groups.push({ key, draft: { ...newSiteDraft(selected.name, selected.kind === 'landing' || selected.kind === 'both' ? selected.kind : 'takeoff', { lat: input.lat, lon: input.lon }), id: selected.id, expectedUpdatedAt: selected.updatedAt.toISOString() }, points: [], normalized: '', endpoint: input.endpoint, review: false });
          resolutions.push({ ...base, name: selected.name, groupKey: key, outcome: 'mapped', reason: 'Add a private map pin to the selected site from flight coordinates.' });
        } else resolutions.push({ ...base, name: selected.name, siteId: selected.id, outcome: 'review', reason: 'These flights have widely separated positions for the selected site. Choose its pin in the editor.' });
        continue;
      }
      const conflict = hasSitePoint(input) && hasSitePoint(selected) && !locationMatches(selected, input.lat, input.lon, radiusForKind(input.endpoint)).matched;
      resolutions.push({ ...base, name: selected.name, siteId: selected.id, outcome: conflict ? "review" : "existing", reason: conflict ? "The flight position is outside the selected site's area. Your selection is preserved." : null });
      continue;
    }
    const compatible = candidates.filter(site => kindMatches(site.kind, input.endpoint));
    const sameName = valid.ok ? compatible.filter(site => site.normalizedName === valid.normalizedName) : [];
    const matches = hasSitePoint(input) ? compatible.filter(site => hasSitePoint(site) && locationMatches(site, input.lat, input.lon, radiusForKind(input.endpoint)).matched) : [];
    const namedMatches = valid.ok ? matches.filter(site => site.normalizedName === valid.normalizedName) : [];
    const match = matches.length === 1 ? matches[0]
      : namedMatches.length === 1 ? namedMatches[0]
      : !hasSitePoint(input) && sameName.length === 1 ? sameName[0]
      : null;
    if (match) {
      resolutions.push({ ...base, name: match.name, siteId: match.id, outcome: "existing" });
      continue;
    }
    let reason = !hasSitePoint(input) && (input.lat !== null || input.lon !== null) ? "The stored coordinates are incomplete or invalid. Review this location." : matches.length > 1 ? "More than one site covers this position. Choose the intended site."
      : !hasSitePoint(input) && sameName.length > 1 ? "Several available sites have this name. Choose the intended site." : null;
    if (!valid.ok) {
      if (name && valid.error !== "reserved") reason = "Review the imported site name; the original text is retained.";
      resolutions.push({ ...base, name: valid.error === "reserved" ? null : base.name, outcome: reason ? "review" : "none", reason });
      continue;
    }
    const point = hasSitePoint(input) ? { lat: input.lat, lon: input.lon } : null;
    const review = reason !== null;
    let group = groups.find(group => group.normalized === valid.normalizedName && group.endpoint === input.endpoint && group.review === review
      && Boolean(group.points.length) === Boolean(point)
      && (!point || group.points.every(other => haversineM(point.lat, point.lon, other.lat, other.lon) <= IMPORT_CLUSTER_DIAMETER_M[input.endpoint])));
    if (!group) {
      group = { key: `group:${input.key}`, draft: newSiteDraft(valid.name, input.endpoint, review ? null : point), points: [], normalized: valid.normalizedName, endpoint: input.endpoint, review };
      groups.push(group);
    }
    if (point && !group.points.some(other => other.lat === point.lat && other.lon === point.lon)) group.points.push(point);
    resolutions.push({ ...base, name: valid.name, groupKey: group.key, outcome: review ? "review" : point ? "mapped" : "unmapped", reason });
  }
  // Choose an observed point, not a synthetic location. Pairwise diameter checks
  // above prevent a chain of nearby rows joining geographically distant sites.
  for (const group of groups) {
    if (group.points.length < 2 || group.review) continue;
    const lat = group.points.reduce((sum, point) => sum + point.lat, 0) / group.points.length;
    const lon = Math.atan2(group.points.reduce((sum, point) => sum + Math.sin(point.lon * Math.PI / 180), 0),
      group.points.reduce((sum, point) => sum + Math.cos(point.lon * Math.PI / 180), 0)) * 180 / Math.PI;
    const representative = group.points.reduce((best, point) => haversineM(point.lat, point.lon, lat, lon) < haversineM(best.lat, best.lon, lat, lon) ? point : best);
    group.draft = { ...group.draft, ...representative };
  }
  return { resolutions, groups: groups.map(({ key, draft }) => ({ key, draft })) };
}
