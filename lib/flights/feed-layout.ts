import type { FlightTrophy } from "./trophies";
import { trophyGroups } from "./trophy-groups";

// Ordered by shrinking card width. Trophy capacity falls from six at 840px
// to one below 680px, before any of these information-hiding steps.
export const FEED_LAYOUT_STEPS = [
  { below: 640, change: "Use compact trophy icons" },
  { below: 600, change: "Hide upload source" },
  { below: 360, change: "Place site above date/time/duration" },
  { below: 300, change: "Hide maximum altitude and combine badge columns" },
] as const;

export function feedLayout(width: number, trophySets: FlightTrophy[][]) {
  const upload = width >= 600, altitude = width >= 300;
  const stacked = width < 360, compactTrophies = width < 640;
  const combinedBadges = width < 300;
  const padding = Math.max(4, Math.min(12, width * .012));
  const gap = Math.max(3, Math.min(12, width * .01));
  const date = stacked ? 0 : Math.max(104, Math.min(132, width * .16));
  const alt = altitude ? Math.max(76, Math.min(96, width * .10)) : 0;
  const friends = Math.max(32, Math.min(48, width * .05));
  const source = upload ? 32 : 0;
  const pill = compactTrophies ? 24 : 44;
  const hasTrophies = trophySets.some(set => set.length);
  // Use width alone, not space released by later layout changes. Hiding a
  // column or reducing pill size must never undo an earlier trophy grouping.
  // Each 40px reduction sacrifices another slot; freed space goes to the site.
  const slots = Math.max(1, Math.min(6, 1 + Math.floor((width - 640) / 40)));
  // Reclaim unused slots after medal grouping, shared across the whole list.
  const count = Math.max(0, ...trophySets.map(set => trophyGroups(set, slots).length));
  const trophies = count ? count * pill + (count - 1) * 4 : 0;
  const columns = combinedBadges ? "minmax(0,1fr) auto"
    : [!stacked && `${date}px`, "minmax(0,1fr)", altitude && `${alt}px`, `${friends}px`, hasTrophies && `${trophies}px`, upload && `${source}px`].filter(Boolean).join(" ");
  return { width, upload, altitude, stacked, compactTrophies, combinedBadges, padding, gap, slots, trophies, hasTrophies, columns };
}
