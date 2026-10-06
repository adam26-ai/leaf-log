import { beforeEach, expect, it, vi } from "vitest";
import { getNavigationCounts } from "./notification-actions";
const mocks = vi.hoisted(() => ({ profile: vi.fn(), counts: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentProfile: mocks.profile }));
vi.mock("@/lib/social/notifications", () => ({ navigationCounts: mocks.counts }));
beforeEach(() => { vi.resetAllMocks(); });

it("returns no notifications or writes for anonymous visitors", async () => {
  mocks.profile.mockResolvedValue(null);
  expect(await getNavigationCounts("2026-10-05")).toEqual({ feed: 0, friends: 0 });
  expect(mocks.counts).not.toHaveBeenCalled();
});

it("uses the signed-in account and ignores invalid visit times", async () => {
  mocks.profile.mockResolvedValue({ id: "current-user" });
  mocks.counts.mockResolvedValue({ feed: 2, friends: 1 });
  expect(await getNavigationCounts("invalid")).toEqual({ feed: 2, friends: 1 });
  expect(mocks.counts).toHaveBeenCalledWith("current-user", undefined);
});

it("cannot mark future flights as already seen", async () => {
  mocks.profile.mockResolvedValue({ id: "current-user" });
  const before = Date.now();
  await getNavigationCounts("2999-01-01");
  const saved = mocks.counts.mock.calls[0][1] as Date;
  expect(saved.getTime()).toBeGreaterThanOrEqual(before);
  expect(saved.getTime()).toBeLessThanOrEqual(Date.now());
});
