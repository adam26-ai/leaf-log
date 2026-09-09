import { beforeEach, expect, it, vi } from "vitest";
import { saveWingNames } from "./wing-actions";
const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const edit = { sources: [{ name: "Rush4", count: 2 }], target: "Ozone Rush 4" };
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("owner"); });
it("rejects anonymous bulk edits before touching flights", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await saveWingNames(edit)).error).toMatch(/sign in/);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("rejects empty selections, invalid counts, empty or multiline and oversized names", async () => {
  for (const invalid of [null, { ...edit, sources: [] }, { ...edit, sources: [{ name: "Rush4", count: -1 }] },
    { ...edit, target: "  " }, { ...edit, target: "Wing\nName" }, { ...edit, target: "x".repeat(201) }]) {
    expect((await saveWingNames(invalid)).error).toBeTruthy();
  }
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("reports changed source selections without attempting the bulk update", async () => {
  const update = vi.fn();
  mocks.transaction.mockImplementation(async callback => callback({ flight: { groupBy: async () => [], updateMany: update } }));
  expect(await saveWingNames(edit)).toMatchObject({ stale: true });
  expect(update).not.toHaveBeenCalled();
});
