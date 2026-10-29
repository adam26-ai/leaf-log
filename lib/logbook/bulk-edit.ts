import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listOwnFlights } from "@/lib/flights/repo";
import { flightFlags, FLIGHT_FLAGS } from "@/lib/flights/type-flags";
import { lockWingSettings, tandemFlightData, wingIsTandem } from "@/lib/flights/tandem";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { locationCachePatch } from "@/lib/sites/associate";
import { lockSiteRows, lockFlightRow } from "@/lib/sites/locks";
import { FLIGHT_TYPE_TAGS, LAUNCH_TYPES } from "@/lib/ratings/skill-tags";
import { flightToEntryDraft } from "./flight-draft";
import { parseEntry, type EntryDraft } from "./entry";
import { EntryError } from "./service";
import { bulkRequestSchema, EDIT_FIELDS, isRecordedField, type EditorFlight, type EditValues, type EditField } from "./advanced";

/** Serialize only owner-editable data, using the viewer-scoped repo's site labels. */
export async function listEditorFlights(ownerId: string): Promise<EditorFlight[]> {
  const [list, raw] = await Promise.all([listOwnFlights(ownerId), prisma.flight.findMany({ where: { ownerId } })]);
  const byId = new Map(raw.map(row => [row.id, row]));
  return list.map(item => {
    const row = byId.get(item.id)!;
    const draft = flightToEntryDraft({ ...row, ...item });
    const values = Object.fromEntries(Object.keys(EDIT_FIELDS).map(key => [key, draft[key as keyof EntryDraft] ?? ""])) as EditValues;
    Object.assign(values, { visibility: row.visibility, takeoffSite: item.takeoffSiteId ? `site:${item.takeoffSiteId}` : item.takeoffSiteName ? `name:${item.takeoffSiteName}` : "",
      landingSite: item.landingSiteId ? `site:${item.landingSiteId}` : item.landingSiteName ? `name:${item.landingSiteName}` : "",
      flightTypes: flightFlags(row).join(";"), flightTypeTags: row.flightTypeTags.join(";"), launchTypes: row.launchTypes.join(";"),
      restrictedLandingField: String(row.restrictedLandingField), instructorId: row.instructorId ?? "" });
    return { id: row.id, updatedAt: row.updatedAt.toISOString(), recorded: row.recordingKind !== "logbook", values, list: item };
  });
}

function tags(value: string, allowed: readonly string[]) {
  const chosen = value ? value.split(";") : [];
  if (chosen.some(tag => !allowed.includes(tag))) throw new EntryError("Choose one of the available flight tags.");
  return [...new Set(chosen)];
}

/** One atomic, owner-scoped save. Stale versions abort edits AND deletions together. */
export async function saveBulkEdits(ownerId: string, input: unknown) {
  const request = bulkRequestSchema.parse(input);
  const ids = request.changes.map(row => row.id);
  if (new Set(ids).size !== ids.length) throw new EntryError("A flight occurs more than once in this draft.");
  return prisma.$transaction(async tx => {
    const settings = await lockWingSettings(tx, ownerId);
    const selectedSites = request.changes.flatMap(change => Object.entries(change.values ?? {}).filter(([key, value]) => ["takeoffSite", "landingSite"].includes(key) && value?.startsWith("site:")).map(([, value]) => value!.slice(5)));
    await lockSiteRows(tx, selectedSites);
    for (const id of [...ids].sort()) await lockFlightRow(tx, id, ownerId);
    const flights = await tx.flight.findMany({ where: { id: { in: ids }, ownerId } });
    if (flights.length !== ids.length) throw new EntryError("One or more flights are not available to edit.", 404);
    const sites = await tx.site.findMany({ where: { id: { in: selectedSites }, ...siteVisibleWhere(ownerId), archivedAt: null } });
    if (new Set(selectedSites).size !== sites.length) throw new EntryError("A selected site is no longer available. Choose it again.", 409);
    for (const change of request.changes) {
      const current = flights.find(row => row.id === change.id)!;
      if (current.updatedAt.toISOString() !== change.expectedUpdatedAt) throw new EntryError("A flight changed in another tab. Your draft has been kept. Reload the logbook before saving again.", 409);
      if (change.delete) { await tx.flight.delete({ where: { id: current.id, ownerId } }); continue; }
      const values = change.values ?? {};
      const keys = Object.keys(values) as EditField[];
      if (!keys.length) continue;
      if (current.recordingKind !== "logbook" && keys.some(isRecordedField)) throw new EntryError("Recorded measurements are read only. Edit only pilot-entered fields for IGC flights.");
      const data: Prisma.FlightUncheckedUpdateInput = {};
      if (keys.some(isRecordedField)) {
        const draft = { ...flightToEntryDraft(current), ...Object.fromEntries(keys.filter(isRecordedField).map(key => [key, values[key]])) };
        const parsed = parseEntry(draft);
        if (!parsed.ok) throw new EntryError(parsed.issues.map(issue => `${issue.field}: ${issue.message}`).join(" "));
        const mapping = { maxAltitude: "maxAltM", launchAltitude: "launchAltM", heightGained: "altGainM", maxClimb: "maxClimbMs", maxSink: "maxSinkMs", xcDistance: "reportedXcDistanceM", xcType: "reportedXcType", takeoffLat: "takeoffLat", takeoffLon: "takeoffLon", landingLat: "landingLat", landingLon: "landingLon" } as const;
        for (const [key, column] of Object.entries(mapping)) if (Object.hasOwn(values, key)) Object.assign(data, { [column]: parsed.data[column] });
        if (keys.some(key => ["date", "takeoffTime", "timeZone", "durationMinutes"].includes(key))) {
          const p = parsed.data;
          Object.assign(data, { flightDate: p.flightDate, takeoffAt: p.takeoffAt, landingAt: p.landingAt, durationS: p.durationS, localTz: p.localTz, localUtcOffsetMinutes: p.localUtcOffsetMinutes });
        }
      }
      for (const endpoint of ["takeoff", "landing"] as const) {
        const value = values[`${endpoint}Site`];
        if (value === undefined) continue;
        if (value.startsWith("site:")) {
          const site = sites.find(site => site.id === value.slice(5));
          if (!site) throw new EntryError("The selected site is not available.", 404);
          Object.assign(data, locationCachePatch(site, null, endpoint), { [`${endpoint}SiteAssignment`]: "user_selected" });
        } else {
          if (value && !value.startsWith("name:")) throw new EntryError("Choose a site or enter a custom site name.");
          const name = value.slice(5).trim();
          if (name.length > 200 || /[\r\n\x00]/.test(name)) throw new EntryError("Use a site name of 200 characters or fewer on one line.");
          Object.assign(data, { [`${endpoint}SiteId`]: null, [`${endpoint}ZoneId`]: null, [`${endpoint}ZoneName`]: null, [`${endpoint}SiteName`]: name || null, [`${endpoint}SiteAssignment`]: name ? "custom_name" : "cleared" });
        }
      }
      if (values.glider !== undefined) {
        if (values.glider.trim().length > 200 || /[\r\n\x00]/.test(values.glider)) throw new EntryError("Use a wing name of 200 characters or fewer on one line.");
        data.glider = values.glider.trim() || null;
      }
      if (values.notes !== undefined) data.notes = values.notes.trim() || null;
      if (values.visibility !== undefined) {
        if (!["public", "friends", "private"].includes(values.visibility)) throw new EntryError("Choose a valid visibility.");
        data.visibility = values.visibility;
      }
      let flags = values.flightTypes === undefined ? flightFlags(current) : tags(values.flightTypes, FLIGHT_FLAGS);
      if (values.flightTypeTags !== undefined) data.flightTypeTags = tags(values.flightTypeTags, FLIGHT_TYPE_TAGS);
      if (values.launchTypes !== undefined) {
        data.launchTypes = tags(values.launchTypes, LAUNCH_TYPES);
        flags = flags.filter(flag => flag !== "tow");
        if ((data.launchTypes as string[]).includes("ST")) flags.push("tow");
      }
      if (values.restrictedLandingField !== undefined) {
        if (!["true", "false"].includes(values.restrictedLandingField)) throw new EntryError("Choose Yes or No for restricted landing field.");
        data.restrictedLandingField = values.restrictedLandingField === "true";
      }
      if (values.occupancy !== undefined && !["solo", "tandem", ""].includes(values.occupancy)) throw new EntryError("Choose solo, tandem, or unknown.");
      const tandemTouched = values.occupancy !== undefined || values.flightTypes !== undefined;
      if (tandemTouched || values.launchTypes !== undefined || values.glider !== undefined) {
        const tandem = values.occupancy !== undefined ? values.occupancy === "tandem" : values.flightTypes !== undefined ? flags.includes("tandem")
          : current.tandemOverride ?? (values.glider !== undefined ? wingIsTandem(settings.tandemWings, data.glider as string | null) : flags.includes("tandem"));
        Object.assign(data, tandemFlightData(flags, tandem));
        if (tandemTouched) data.tandemOverride = tandem;
        if (values.flightTypes !== undefined && values.launchTypes === undefined) data.launchTypes = [...current.launchTypes.filter(tag => tag !== "ST"), ...(flags.includes("tow") ? ["ST"] : [])];
      }
      if (values.instructorId !== undefined && values.instructorId !== current.instructorId) {
        const instructor = values.instructorId || null;
        if (instructor && !await tx.friendship.findFirst({ where: { status: "accepted", OR: [{ requesterId: ownerId, addresseeId: instructor }, { requesterId: instructor, addresseeId: ownerId }] } })) throw new EntryError("Choose an instructor from your accepted friends.");
        data.instructorId = instructor;
      }
      const result = await tx.flight.updateMany({ where: { id: current.id, ownerId, updatedAt: new Date(change.expectedUpdatedAt) }, data });
      if (!result.count) throw new EntryError("A flight changed while saving. Your draft has been kept.", 409);
    }
    return { updated: request.changes.filter(change => !change.delete).length, deleted: request.changes.filter(change => change.delete).length };
  }, { maxWait: 10000, timeout: 30000 });
}
