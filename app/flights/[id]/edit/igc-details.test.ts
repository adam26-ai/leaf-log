import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { flight: { updateMany: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/ratings/authz", () => ({ canAssignInstructor: vi.fn() }));
import { updateIgcDetails } from "./actions";

function form(pilot = " Pilot Name ", glider = " Wing Name ") {
  const data = new FormData();
  data.set("pilot", pilot);
  data.set("glider", glider);
  return data;
}
describe("IGC detail corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue("owner");
    mocks.update.mockResolvedValue({ count: 1 });
  });
  it("requires authentication before writing", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await updateIgcDetails("flight", {}, form())).toHaveProperty("error");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("trims names and restricts updates to the owner", async () => {
    expect(await updateIgcDetails("flight", {}, form())).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "flight", ownerId: "owner" },
      data: { pilot: "Pilot Name", glider: "Wing Name" },
    });
  });
  it("does not report success for another user's flight", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect(await updateIgcDetails("other-flight", {}, form())).toHaveProperty("error");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects multiline and oversized names", async () => {
    expect(await updateIgcDetails("flight", {}, form("one\ntwo"))).toHaveProperty("error");
    expect(await updateIgcDetails("flight", {}, form("a".repeat(201)))).toHaveProperty("error");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("preserves an intentional blank pilot rather than restoring the IGC header", async () => {
    await updateIgcDetails("flight", {}, form("", ""));
    expect(mocks.update.mock.calls[0][0].data).toEqual({ pilot: "", glider: null });
  });
});
