import { z } from "zod";
import type { Boundary } from "./geo";

export type SitePoint = { lat: number; lon: number };
export function hasSitePoint<T extends { lat: number | null; lon: number | null }>(value: T): value is T & SitePoint {
  return value.lat !== null && value.lon !== null && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180;
}

/** Shared by persisted and staged editors; all mutations revalidate server-side. */
export const siteDraftSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  name: z.string().max(200),
  kind: z.enum(["takeoff", "landing", "both"]),
  visibility: z.enum(["private", "public"]),
  lat: z.number().finite().min(-90).max(90).nullable(),
  lon: z.number().finite().min(-180).max(180).nullable(),
  boundary: z.unknown().optional(),
}).strict();
export type SiteDraft = z.infer<typeof siteDraftSchema>;
export type SiteEditorValue = Omit<SiteDraft, "boundary"> & { boundary: Boundary | null };
export const newSiteDraft = (name = "", kind: SiteDraft["kind"] = "takeoff", point: SitePoint | null = null): SiteEditorValue => ({
  name, kind, visibility: "private", lat: point?.lat ?? null, lon: point?.lon ?? null, boundary: null,
});

export function siteLocationLabel(site: { lat: number | null; lon: number | null }, hasEvidence = false): string {
  return hasSitePoint(site) ? "Mapped" : hasEvidence ? "Location needs review" : "Name only";
}
