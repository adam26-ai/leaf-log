import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { beforeEach, expect, it, vi } from "vitest";
import { queueFlightXc, queueMissingFlightAnalysis } from "./queue-xc-action";
const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), find: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { flight: { updateMany: mocks.update, findFirst: mocks.find, findMany: mocks.list } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const flight = { id: "f", status: "ready", xcStatus: "unscored", metricsVersion: METRICS_VERSION, xcScore: null };
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("owner"); mocks.find.mockResolvedValue(flight); mocks.update.mockResolvedValue({ count: 1 }); });
it("rejects anonymous requests without reading or writing flights", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await queueFlightXc("f")).error).toBeTruthy();
  expect((await queueMissingFlightAnalysis("xc")).error).toBeTruthy();
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("scopes both the read and conditional update to the owner", async () => {
  expect(await queueFlightXc("f")).toEqual({});
  expect(mocks.find.mock.calls[0][0].where).toEqual({ id: "f", ownerId: "owner" });
  expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "f", ownerId: "owner", xcStatus: "unscored", metricsVersion: METRICS_VERSION });
  expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("xcScore");
});
it("treats an already running owned flight as success without requeueing", async () => {
  mocks.find.mockResolvedValue({ ...flight, xcStatus: "processing" });
  expect(await queueFlightXc("f")).toEqual({});
  expect(mocks.update).not.toHaveBeenCalled();
});
it("does not authorize someone else's flight or an unavailable original", async () => {
  mocks.find.mockResolvedValue(null);
  expect((await queueFlightXc("f")).error).toBeTruthy();
  mocks.find.mockResolvedValue({ ...flight, xcStatus: "unavailable" });
  expect((await queueFlightXc("f")).error).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("bulk actions include hidden flights, separate repair, and skip already queued work", async () => {
  mocks.list.mockResolvedValue([flight, { ...flight, id: "repair", metricsVersion: 0 }, { ...flight, id: "waiting", xcStatus: "queued" }]);
  expect(await queueMissingFlightAnalysis("xc")).toEqual({ count: 1 });
  expect(mocks.list.mock.calls[0][0].where).toEqual({ ownerId: "owner" });
  expect(await queueMissingFlightAnalysis("repair")).toEqual({ count: 1 });
  expect(mocks.update.mock.calls[1][0].data.xcStatus).toBe("repair_queued");
});
