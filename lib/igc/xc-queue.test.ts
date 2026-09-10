import { beforeEach, expect, it, vi } from "vitest";
import { processNextXcJob } from "./xc-queue";
import { METRICS_VERSION } from "../flights/analysis-state";
const mocks = vi.hoisted(() => ({ lock: vi.fn(), find: vi.fn(), claim: vi.fn(), recover: vi.fn(), update: vi.fn(), data: vi.fn(), score: vi.fn(), saveData: vi.fn(), derive: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: mocks.lock,
    flight: { findFirst: mocks.find, update: mocks.claim, updateMany: mocks.recover }, flightData: { update: mocks.saveData } }),
  flight: { updateMany: mocks.update }, flightData: { findUnique: mocks.data },
} }));
vi.mock("../ingest/ingest-flight", () => ({ PARSER_VERSION: "2" }));
vi.mock("./parse", () => ({ parseIgc: () => ({ fixes: [], warnings: [] }) }));
vi.mock("./derive", () => ({ deriveMetrics: mocks.derive }));
vi.mock("./track-artifact", () => ({ buildTrackArtifact: () => ({ v: 1 }) }));
vi.mock("./replay-artifact", () => ({ buildReplayArtifact: () => ({ v: 1 }) }));
vi.mock("./xc", () => ({ analyzeXc: mocks.score }));
const flight = { id: "test", igcSha256: "recorded-file-hash", recordingKind: "igc", xcStatus: "processing", xcStartedAt: new Date(), metricsVersion: METRICS_VERSION, xcScore: { saved: true } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.lock.mockResolvedValue([{ locked: true }]);
  mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...flight, xcStatus: "queued" });
  mocks.claim.mockResolvedValue(flight); mocks.recover.mockResolvedValue({ count: 1 });
  mocks.data.mockResolvedValue({ rawIgc: new Uint8Array([1]) });
  mocks.derive.mockReturnValue({ takeoffIndex: 0, landingIndex: 1, takeoff: { lat: 0, lon: 0 }, landing: { lat: 0, lon: 0 } });
  mocks.score.mockResolvedValue({ score: null, complete: true, completedCategories: ["open", "free-triangle", "fai-triangle"], emptyReason: "no_eligible_route" });
});
it("does not run a scorer when another consumer holds the lock", async () => {
  mocks.lock.mockResolvedValue([{ locked: false }]);
  expect(await processNextXcJob()).toBe(false); expect(mocks.score).not.toHaveBeenCalled();
});
it("blocks a second worker while a live processing lease exists", async () => {
  mocks.find.mockReset().mockResolvedValue({ id: "active" });
  expect(await processNextXcJob()).toBe(false); expect(mocks.claim).not.toHaveBeenCalled();
});
it("recovers stale processing, repair and improvement jobs with their original modes", async () => {
  await processNextXcJob();
  expect(mocks.recover.mock.calls.slice(0, 3).map(call => [call[0].where.xcStatus, call[0].data.xcStatus]))
    .toEqual([["processing", "queued"], ["repairing", "repair_queued"], ["improving", "improve_queued"]]);
  expect(mocks.recover.mock.calls[0][0].where.OR).toContainEqual({ xcStartedAt: null });
});
it("saves a complete empty result and guards writes with the claimed lease", async () => {
  expect(await processNextXcJob()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: flight.id, xcStatus: "processing", xcStartedAt: flight.xcStartedAt },
    data: expect.objectContaining({ xcStatus: "empty", xcStartedAt: null, xcScore: expect.objectContaining({ complete: true, emptyReason: "no_eligible_route" }) }),
  }));
});
it("keeps saved results on failure and stops retrying missing originals", async () => {
  mocks.score.mockRejectedValue(new Error("limit"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await processNextXcJob(); log.mockRestore();
  expect(mocks.update.mock.calls[0][0].data.xcStatus).toBe("failed");
  expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("xcScore");
  mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...flight, xcStatus: "queued" });
  mocks.data.mockResolvedValue(null);
  await processNextXcJob();
  expect(mocks.update.mock.calls[1][0].data.xcStatus).toBe("unavailable");
});
it("repairs derived fields and artifacts without overwriting pilot edits", async () => {
  mocks.claim.mockResolvedValue({ ...flight, metricsVersion: 0, xcStatus: "repairing" });
  await processNextXcJob();
  const repair = mocks.recover.mock.calls[3][0].data;
  expect(repair.metricsVersion).toBe(METRICS_VERSION); expect(repair.parserVersion).toBe("2");
  expect(repair).not.toHaveProperty("glider"); expect(repair).not.toHaveProperty("takeoffSiteId");
  expect(mocks.saveData).toHaveBeenCalled();
});
