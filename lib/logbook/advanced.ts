import { z } from "zod";
import type { FlightListItem } from "@/lib/flights/repo";
import { flightCalendarDate } from "@/lib/flights/logbook-filters";
import { formatDuration, formatLocalDate, formatLocalTime } from "@/lib/flights/format";

export const EDIT_FIELDS = {
  date: { label: "Date", type: "date", recorded: true },
  takeoffTime: { label: "Takeoff time", type: "time", recorded: true },
  timeZone: { label: "Time zone / UTC offset", type: "text", recorded: true },
  durationMinutes: { label: "Duration (minutes)", type: "number", recorded: true },
  takeoffSite: { label: "Flying site", type: "site" },
  landingSite: { label: "Landing site", type: "site" },
  glider: { label: "Wing", type: "text" },
  maxAltitude: { label: "Maximum altitude (m MSL)", type: "number", recorded: true },
  launchAltitude: { label: "Launch altitude (m MSL)", type: "number", recorded: true },
  heightGained: { label: "Total climbs (m)", type: "number", recorded: true },
  maxClimb: { label: "Best climb (m/s)", type: "number", recorded: true },
  maxSink: { label: "Max sink (m/s)", type: "number", recorded: true },
  xcDistance: { label: "XC distance (km)", type: "number", recorded: true },
  xcType: { label: "XC type", type: "xc", recorded: true },
  takeoffLat: { label: "Takeoff latitude", type: "number", recorded: true },
  takeoffLon: { label: "Takeoff longitude", type: "number", recorded: true },
  landingLat: { label: "Landing latitude", type: "number", recorded: true },
  landingLon: { label: "Landing longitude", type: "number", recorded: true },
  visibility: { label: "Visibility", type: "visibility" },
  notes: { label: "Notes", type: "notes" },
  flightTypes: { label: "Flight types", type: "flags" },
  occupancy: { label: "Solo or tandem", type: "occupancy" },
  flightTypeTags: { label: "Ratings flight tags", type: "tags" },
  launchTypes: { label: "Launch types", type: "launch" },
  restrictedLandingField: { label: "Restricted landing field", type: "boolean" },
  instructorId: { label: "Instructor", type: "instructor" },
} as const;
export type EditField = keyof typeof EDIT_FIELDS;
export type EditValues = Record<EditField, string>;
export type EditorFlight = { id: string; updatedAt: string; recorded: boolean; values: EditValues; list: FlightListItem };
export type DraftChange = { id: string; expectedUpdatedAt: string; values?: Partial<EditValues>; delete?: boolean };
export const editFieldSchema = z.enum(Object.keys(EDIT_FIELDS) as [EditField, ...EditField[]]);
export const bulkRequestSchema = z.object({ changes: z.array(z.object({
  id: z.string().min(1).max(100), expectedUpdatedAt: z.string().datetime(),
  values: z.partialRecord(editFieldSchema, z.string().max(2000)).optional(), delete: z.boolean().optional(),
}).strict()).min(1).max(1000) }).strict();
export function isRecordedField(key: EditField) { return "recorded" in EDIT_FIELDS[key]; }
export const missingValue = (value: string | null | undefined) => value == null || !value.trim();
export const countLabel = (n: number, label: string) => `${n} ${n === 1 ? label : label.endsWith("entry") ? label.replace(/entry$/, "entries") : label + "s"}`;
export function flightSummary(flight: EditorFlight) {
  const v = flight.values;
  return [v.date ? formatLocalDate(v.date + "T12:00:00Z", 0) : "Date unknown", v.takeoffTime?.slice(0, 5) || "Time unknown", formatDuration(v.durationMinutes ? Number(v.durationMinutes) * 60 : null), flight.list.takeoffSiteName || flight.list.landingSiteName || "Unknown site"].join(" · ");
}
export function listDate(flight: FlightListItem) { return flightCalendarDate(flight); }
export function listTime(flight: FlightListItem) { return formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes); }
export function diffValues(base: EditorFlight, values: EditValues): Partial<EditValues> {
  return Object.fromEntries((Object.keys(EDIT_FIELDS) as EditField[]).filter(key => base.values[key] !== values[key]).map(key => [key, values[key]]));
}
