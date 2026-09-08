import { beforeEach, expect, it, vi } from "vitest";
import { processNextXcJob } from "./xc-queue";
const mocks = vi.hoisted(() => ({ lock: vi.fn(), find: vi.fn(), update: vi.fn(), score: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({
  $queryRaw: mocks.lock, flight: { findFirst: mocks.find, update: mocks.update },
}) } }));
vi.mock("./parse", () => ({ parseIgc: () => ({ fixes: [] }) }));
vi.mock("./derive", () => ({ deriveMetrics: () => ({ takeoffIndex: 0, landingIndex: 1 }) }));
vi.mock("./xc", () => ({ scoreXc: mocks.score }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockResolvedValue([{ locked: true }]);
  mocks.find.mockResolvedValue({ id: "test", data: { rawIgc: new Uint8Array([1]) } });
  mocks.update.mockResolvedValue({});
});
it("does not create a scorer when another consumer holds the database lock", async () => {
  mocks.lock.mockResolvedValue([{ locked: false }]);
  expect(await processNextXcJob()).toBe(false);
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.score).not.toHaveBeenCalled();
});
it("records completed scoring without altering flight readiness", async () => {
  mocks.score.mockResolvedValue({ version: 1 });
  expect(await processNextXcJob()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "test" }, data: { xcScore: { version: 1 }, xcStatus: "ready", xcError: null } });
});
it("marks failed scoring separately so uploads remain available", async () => {
  mocks.score.mockRejectedValue(new Error("Memory limit"));
  await processNextXcJob();
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "test" }, data: { xcStatus: "failed", xcError: "Memory limit" } });
});
