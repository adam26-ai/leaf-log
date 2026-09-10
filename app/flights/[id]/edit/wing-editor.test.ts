import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { flight: { updateMany: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/ratings/authz", () => ({ canAssignInstructor: vi.fn() }));
import { updateFlightWing } from "./actions";

function form(glider = " Wing Name ") {
  const data = new FormData();
  data.set("glider", glider);
  return data;
}
describe("wing corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue("owner");
    mocks.update.mockResolvedValue({ count: 1 });
  });
  it("requires authentication before writing", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await updateFlightWing("flight", {}, form())).toHaveProperty("error");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates only the owner's wing, preserving pilot metadata even when a stale form sends a pilot", async () => {
    const data = form();
    data.set("pilot", "A replacement pilot name");
    expect(await updateFlightWing("flight", {}, data)).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "flight", ownerId: "owner" },
      data: { glider: "Wing Name" },
    });
  });
  it("does not report success for another user's flight", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect(await updateFlightWing("other-flight", {}, form())).toHaveProperty("error");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects multiline and oversized names", async () => {
    expect(await updateFlightWing("flight", {}, form("one\ntwo"))).toHaveProperty("error");
    expect(await updateFlightWing("flight", {}, form("a".repeat(201)))).toHaveProperty("error");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("allows an unknown wing without changing pilot information", async () => {
    await updateFlightWing("flight", {}, form(""));
    expect(mocks.update.mock.calls[0][0].data).toEqual({ glider: null });
  });
});
