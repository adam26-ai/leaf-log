// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Flight } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { LAUNCH_ALTITUDE_JOB, repairLaunchAltitudes } from "@/lib/maintenance/repair-launch-altitudes";
import { makeIgc } from "./igc/make-igc";

let ownerId: string;
beforeEach(async () => {
  const unique = randomUUID().replaceAll("-", "");
  const user = await prisma.user.create({ data: { email: `${unique}@maintenance.test`,
    profile: { create: { handle: `m${unique.slice(0, 15)}`, displayName: "Maintenance test" } } } });
  ownerId = user.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.maintenanceJob.deleteMany({ where: { id: LAUNCH_ALTITUDE_JOB } });
});

function recording(firstAccuracy = 800, interval = 1) {
  const base = makeIgc({ fixes: [0, 764, 752, 748, 744, 1074].map((gps, index) => ({
    tSec: 36000 + index * interval, lat: 37.8 + index * 0.0003, lon: -122.5, gps, baro: 655,
  })) });
  let index = 0;
  return Buffer.from("I013638FXA\n" + base.split("\n").map(line => line.startsWith("B")
    ? line + String(index++ === 0 ? firstAccuracy : 7).padStart(3, "0") : line).join("\n") + `LTEST${randomUUID()}\n`);
}

type Patch = Partial<Pick<Flight, "recordingKind" | "status" | "launchAltM" | "metricsVersion" | "maxAltM"
  | "igcSha256" | "takeoffAt" | "landingAt" | "xcStatus">>;
async function seed(raw = recording(), patch: Patch = {}, missingOriginal = false) {
  const metrics = deriveMetrics(parseIgc(raw))!;
  return prisma.flight.create({ data: {
    ownerId, recordingKind: "igc", status: "ready", launchAltM: 0, metricsVersion: METRICS_VERSION,
    parserVersion: "5", igcSha256: createHash("sha256").update(raw).digest("hex"),
    takeoffAt: new Date(metrics.takeoffAtMs), landingAt: new Date(metrics.landingAtMs), maxAltM: metrics.maxAltM,
    xcStatus: "ready", xcScore: { saved: "keep scored routes" }, notes: "Pilot's note", glider: "Pilot's wing",
    ...patch, ...(missingOriginal ? {} : { data: { create: { rawIgc: raw, track: { keep: "track" }, replay: { keep: "replay" } } } }),
  } });
}

it("previews confirmed repairs without changing a flight or recording completion", async () => {
  const flight = await seed();
  const before = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id }, include: { data: true } });
  expect(await repairLaunchAltitudes()).toMatchObject({ scanned: 1, matched: 1, repaired: 0 });
  expect(await prisma.flight.findUniqueOrThrow({ where: { id: flight.id }, include: { data: true } })).toEqual(before);
  expect(await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })).toBeNull();
});

it("changes only proven zero baselines and preserves originals, scores and pilot edits", async () => {
  const affected = await seed();
  const seaLevel = await seed(recording(7));
  const nonzero = await seed(recording(), { launchAltM: 725 });
  const manual = await seed(recording(), { recordingKind: "logbook" });
  const legacy = await seed(recording(), { metricsVersion: 0 });
  const noOriginal = await seed(recording(), {}, true);
  const hashMismatch = await seed(recording(), { igcSha256: "different source" });
  const windowMismatch = await seed(recording(), { takeoffAt: new Date(0) });
  const unresolved = await seed(recording(800, 20));
  const inconsistentPeak = await seed(recording(), { maxAltM: 100 });
  const ids = [affected, seaLevel, nonzero, manual, legacy, noOriginal, hashMismatch, windowMismatch, unresolved, inconsistentPeak].map(f => f.id);
  const before = await prisma.flight.findMany({ where: { id: { in: ids } }, include: { data: true }, orderBy: { id: "asc" } });
  const report = vi.fn();
  expect(await repairLaunchAltitudes({ apply: true, once: true, batchSize: 1, report }))
    .toMatchObject({ scanned: 7, matched: 1, repaired: 1, unchanged: 1, review: 5, deferred: 0 });
  const after = await prisma.flight.findMany({ where: { id: { in: ids } }, include: { data: true }, orderBy: { id: "asc" } });
  after.forEach((flight, index) => {
    if (flight.id !== affected.id) expect(flight).toEqual(before[index]);
    else expect(flight).toEqual({ ...before[index], launchAltM: 764, updatedAt: flight.updatedAt });
  });
  expect(report).toHaveBeenCalledTimes(5);
  expect(await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })).not.toBeNull();
});

it("skips the entire sweep after completion but permits an explicit manual rescan", async () => {
  await seed();
  await repairLaunchAltitudes({ apply: true, once: true });
  const later = await seed();
  expect(await repairLaunchAltitudes({ apply: true, once: true }))
    .toMatchObject({ scanned: 0, repaired: 0, alreadyCompleted: true });
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: later.id } })).launchAltM).toBe(0);
  expect(await repairLaunchAltitudes({ apply: true })).toMatchObject({ repaired: 1 });
});

it("runs the deployment CLI without manual intervention and skips it after completion", async () => {
  const flight = await seed();
  const args = ["--import", "tsx", "scripts/repair-launch-altitudes.ts", "--apply", "--once"];
  const first = execFileSync(process.execPath, args, { encoding: "utf8", env: process.env, windowsHide: true });
  expect(first).toContain('"repaired":1');
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).launchAltM).toBe(764);
  const second = execFileSync(process.execPath, args, { encoding: "utf8", env: process.env, windowsHide: true });
  expect(second).toContain('"alreadyCompleted":true');
});

it("defers active processing without completing the job, then repairs it on a later run", async () => {
  const flight = await seed(recording(), { xcStatus: "repairing" });
  expect(await repairLaunchAltitudes({ apply: true, once: true })).toMatchObject({ deferred: 1, repaired: 0 });
  expect(await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })).toBeNull();
  await prisma.flight.update({ where: { id: flight.id }, data: { xcStatus: "ready" } });
  expect(await repairLaunchAltitudes({ apply: true, once: true })).toMatchObject({ deferred: 0, repaired: 1 });
});

it("does not overwrite measurements changed between reading the source and writing the correction", async () => {
  const flight = await seed();
  const read = prisma.flightData.findUnique.bind(prisma.flightData);
  vi.spyOn(prisma.flightData, "findUnique").mockImplementationOnce(args => {
    const query = read(args);
    return query.then(async data => {
      await prisma.flight.update({ where: { id: flight.id }, data: { takeoffAt: new Date(0) } });
      return data;
    }) as typeof query;
  });
  expect(await repairLaunchAltitudes({ apply: true, once: true })).toMatchObject({ repaired: 0, deferred: 1 });
  const saved = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
  expect(saved.takeoffAt).toEqual(new Date(0));
  expect(saved.launchAltM).toBe(0);
  expect(await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })).toBeNull();
});

it("resumes safely after a partial failure and only records completion after success", async () => {
  const flights = [await seed(), await seed()];
  const write = prisma.flight.updateMany.bind(prisma.flight);
  const spy = vi.spyOn(prisma.flight, "updateMany")
    .mockImplementationOnce(args => write(args)).mockImplementationOnce(() => { throw new Error("interrupted write"); });
  await expect(repairLaunchAltitudes({ apply: true, once: true, batchSize: 1 })).rejects.toThrow("interrupted write");
  spy.mockRestore();
  expect(await prisma.flight.count({ where: { id: { in: flights.map(f => f.id) }, launchAltM: 764 } })).toBe(1);
  expect(await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })).toBeNull();
  expect(await repairLaunchAltitudes({ apply: true, once: true, batchSize: 1 })).toMatchObject({ scanned: 1, repaired: 1 });
  expect(await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })).not.toBeNull();
});

it("guards concurrent invocations with conditional writes", async () => {
  const flight = await seed();
  const runs = await Promise.all([
    repairLaunchAltitudes({ apply: true, once: true }),
    repairLaunchAltitudes({ apply: true, once: true }),
  ]);
  expect(runs.reduce((sum, run) => sum + run.repaired, 0)).toBe(1);
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).launchAltM).toBe(764);
});

it("records completion safely when several jobs finish an empty sweep together", async () => {
  await Promise.all(Array.from({ length: 6 }, () => repairLaunchAltitudes({ apply: true, once: true })));
  expect(await prisma.maintenanceJob.count({ where: { id: LAUNCH_ALTITUDE_JOB } })).toBe(1);
});

it("rejects invalid options before touching flights", async () => {
  await expect(repairLaunchAltitudes({ once: true })).rejects.toThrow("--once requires --apply");
  await expect(repairLaunchAltitudes({ batchSize: 0 })).rejects.toThrow("Batch size");
});
