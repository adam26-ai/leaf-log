import { z } from "zod";
import { XC_TYPE_LABELS } from "@/lib/flights/recording";

export const ENTRY_FIELDS = {
  date: "Flight date", durationMinutes: "Duration (minutes)", glider: "Wing", takeoffSiteName: "Flying site",
  landingSiteName: "Landing site", takeoffTime: "Takeoff time", timeZone: "Time zone",
  maxAltitude: "Maximum altitude (MSL)", launchAltitude: "Launch altitude (MSL)", heightGained: "Total climbs",
  altitudeUnit: "Altitude unit", xcDistance: "XC distance", xcType: "XC type", distanceUnit: "Distance unit",
  maxClimb: "Best climb", maxSink: "Max sink", varioUnit: "Vertical speed unit",
  takeoffLat: "Site latitude", takeoffLon: "Site longitude", landingLat: "Landing latitude", landingLon: "Landing longitude",
  occupancy: "Solo or tandem", notes: "Notes",
} as const;
export type EntryField = keyof typeof ENTRY_FIELDS;
export type EntryDraft = Record<EntryField, string> & { takeoffSiteId: string; landingSiteId: string };
export const emptyEntry = (imperial = false): EntryDraft => ({
  date: "", durationMinutes: "", glider: "", takeoffSiteName: "", landingSiteName: "", takeoffSiteId: "", landingSiteId: "",
  takeoffTime: "", timeZone: "", maxAltitude: "", launchAltitude: "", heightGained: "", altitudeUnit: imperial ? "ft" : "m",
  xcDistance: "", xcType: "", distanceUnit: imperial ? "mi" : "km", maxClimb: "", maxSink: "", varioUnit: imperial ? "ft/min" : "m/s",
  takeoffLat: "", takeoffLon: "", landingLat: "", landingLon: "", occupancy: "", notes: "",
});

export const draftSchema = z.object(Object.fromEntries(Object.keys(emptyEntry()).map(key => [key, z.string().max(key === "notes" ? 2000 : 200)])) as Record<keyof EntryDraft, z.ZodString>).strict();
export type EntryIssue = { field: keyof EntryDraft; message: string };

export function parseEntry(value: unknown) {
  const shape = draftSchema.safeParse(value);
  if (!shape.success) return { ok: false as const, issues: shape.error.issues.map(issue => ({ field: String(issue.path[0]) as keyof EntryDraft, message: issue.message })) };
  const draft = Object.fromEntries(Object.entries(shape.data).map(([key, val]) => [key, val.trim()])) as EntryDraft;
  const issues: EntryIssue[] = [];
  const issue = (field: keyof EntryDraft, message: string) => issues.push({ field, message });
  const number = (field: keyof EntryDraft, min: number, max: number) => {
    const text = draft[field];
    if (!text) return null;
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text)) || Number(text) < min || Number(text) > max) {
      issue(field, `Use a number between ${min} and ${max}.`); return null;
    }
    return Number(text);
  };
  const flightDate = new Date(`${draft.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(flightDate.getTime()) || flightDate.toISOString().slice(0, 10) !== draft.date || draft.date < "1900-01-01") issue("date", "Use a real flight date in YYYY-MM-DD format.");
  const durationMinutes = number("durationMinutes", 0.016666666, 7 * 24 * 60);
  const altitudeFactor = draft.altitudeUnit === "ft" ? 0.3048 : 1;
  if (!["m", "ft"].includes(draft.altitudeUnit)) issue("altitudeUnit", "Choose meters or feet.");
  if (!["km", "mi", "nmi"].includes(draft.distanceUnit)) issue("distanceUnit", "Choose km, miles, or nautical miles.");
  if (!["m/s", "ft/min", "knots"].includes(draft.varioUnit)) issue("varioUnit", "Choose m/s, ft/min, or knots.");
  const altitude = (field: keyof EntryDraft) => { const n = number(field, -2000 / altitudeFactor, 20000 / altitudeFactor); return n == null ? null : Math.round(n * altitudeFactor); };
  const maxAltM = altitude("maxAltitude"), launchAltM = altitude("launchAltitude");
  if (maxAltM != null && launchAltM != null && maxAltM < launchAltM) issue("maxAltitude", "Maximum altitude cannot be below launch altitude.");
  const gain = number("heightGained", 0, 200000 / altitudeFactor);
  const distance = number("xcDistance", 0.001, 10000);
  if (distance !== null && !Object.hasOwn(XC_TYPE_LABELS, draft.xcType)) issue("xcType", "Choose Open distance, FAI triangle, or Free triangle.");
  if (draft.xcType && distance === null) issue("xcDistance", "Enter the distance for this XC result.");
  if (draft.occupancy && !["solo", "tandem"].includes(draft.occupancy)) issue("occupancy", "Choose solo, tandem, or leave unknown.");
  const takeoffLat = number("takeoffLat", -90, 90), takeoffLon = number("takeoffLon", -180, 180);
  const landingLat = number("landingLat", -90, 90), landingLon = number("landingLon", -180, 180);
  if ((takeoffLat === null) !== (takeoffLon === null)) issue("takeoffLat", "Enter both latitude and longitude, or leave both blank.");
  if ((landingLat === null) !== (landingLon === null)) issue("landingLat", "Enter both latitude and longitude, or leave both blank.");
  const varioFactor = draft.varioUnit === "ft/min" ? 0.3048 / 60 : draft.varioUnit === "knots" ? 1852 / 3600 : 1;
  const climb = number("maxClimb", 0, 100 / varioFactor), sink = number("maxSink", -100 / varioFactor, 100 / varioFactor);
  let takeoffAt: Date | null = null, offset: number | null = null;
  if (draft.takeoffTime) {
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(draft.takeoffTime)) issue("takeoffTime", "Use 24-hour HH:MM or HH:MM:SS.");
    if (!draft.timeZone) issue("timeZone", "Enter a time zone or UTC offset when a takeoff time is known.");
    if (!issues.some(i => ["date", "takeoffTime", "timeZone"].includes(i.field))) {
      try {
        const resolved = localInstant(draft.date, draft.takeoffTime, draft.timeZone);
        takeoffAt = resolved.date; offset = resolved.offset;
      } catch (error) { issue("timeZone", error instanceof Error ? error.message : "Invalid time zone."); }
    }
  }
  if (issues.length) return { ok: false as const, issues };
  return { ok: true as const, draft, data: {
    flightDate, takeoffAt, landingAt: takeoffAt && durationMinutes !== null ? new Date(takeoffAt.getTime() + Math.round(durationMinutes * 60) * 1000) : null,
    localTz: draft.timeZone || null, localUtcOffsetMinutes: offset,
    durationS: durationMinutes == null ? null : Math.round(durationMinutes * 60), glider: draft.glider || null,
    maxAltM, launchAltM, altGainM: gain == null ? null : Math.round(gain * altitudeFactor),
    maxClimbMs: climb == null ? null : climb * varioFactor, maxSinkMs: sink == null ? null : -Math.abs(sink * varioFactor),
    reportedXcDistanceM: distance == null ? null : Math.round(distance * (draft.distanceUnit === "mi" ? 1609.344 : draft.distanceUnit === "nmi" ? 1852 : 1000)),
    reportedXcType: distance == null ? null : draft.xcType,
    takeoffLat, takeoffLon, landingLat, landingLon, notes: draft.notes || null, occupancy: draft.occupancy || null,
    takeoffSiteName: draft.takeoffSiteName || null, landingSiteName: draft.landingSiteName || null,
  } };
}

/** Resolve a wall-clock time without silently moving dates or choosing a DST fold. */
export function localInstant(day: string, time: string, zone: string) {
  const wall = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
  if (/^(?:UTC|Z)$/i.test(zone)) return { date: new Date(wall), offset: 0 };
  const fixed = /^(?:UTC)?([+-])(\d{2}):?(\d{2})$/i.exec(zone);
  if (fixed) {
    const minutes = Number(fixed[2]) * 60 + Number(fixed[3]);
    if (Number(fixed[3]) > 59 || minutes > 14 * 60) throw new Error("Use a UTC offset between -14:00 and +14:00.");
    const offset = (fixed[1] === "-" ? -1 : 1) * minutes;
    return { date: new Date(wall - offset * 60000), offset };
  }
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  catch { throw new Error("Use a time zone such as America/Los_Angeles, or a UTC offset such as -07:00."); }
  const offsetAt = (instant: number) => {
    const p = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return (Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - instant) / 60000;
  };
  const candidates = [...new Set([-86400000, 0, 86400000].map(delta => offsetAt(wall + delta)))].map(offset => ({ date: new Date(wall - offset * 60000), offset })).filter(({ date, offset }) => offsetAt(date.getTime()) === offset);
  if (candidates.length !== 1) throw new Error("This clock time is ambiguous or skipped by daylight saving. Specify its UTC offset instead.");
  return candidates[0];
}

export function entryWarnings(draft: EntryDraft) {
  return [!draft.durationMinutes && "Duration unknown; flight counts, airtime does not.", !draft.glider && "Wing unknown.",
    !draft.takeoffSiteName && "Site unknown.", draft.takeoffSiteName && !draft.takeoffSiteId && !draft.takeoffLat && "Site has no map location yet.",
  ].filter((item): item is string => Boolean(item));
}
