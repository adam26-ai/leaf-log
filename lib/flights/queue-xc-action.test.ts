import { beforeEach, expect, it, vi } from "vitest";
import { queueFlightXc } from "./queue-xc-action";
const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { flight: { updateMany: mocks.update, findFirst: mocks.find } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("owner"); });
it("rejects anonymous requests", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await queueFlightXc("f")).error).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("only queues ready flights belonging to the caller that need scoring", async () => {
  mocks.update.mockResolvedValue({ count: 1 });
  expect(await queueFlightXc("f")).toEqual({});
  expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "f", ownerId: "owner", status: "ready", xcStatus: { in: ["unscored", "failed"] } });
});
it("treats an already queued owned flight as success", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  mocks.find.mockResolvedValue({ xcStatus: "queued" });
  expect(await queueFlightXc("f")).toEqual({});
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it("does not authorize someone else's flight", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  mocks.find.mockResolvedValue(null);
  expect((await queueFlightXc("f")).error).toBeTruthy();
  expect(mocks.find.mock.calls[0][0].where).toEqual({ id: "f", ownerId: "owner" });
});
