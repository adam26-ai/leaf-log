// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { renamePublicRow, toggleEndorsement } from "./community-action";

const { revalidate, toggle, summary, rename } = vi.hoisted(() => ({ revalidate: vi.fn(), toggle: vi.fn(), summary: vi.fn(), rename: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: async () => "pilot" }));
vi.mock("@/lib/sites/associate", () => ({ renameSite: rename, renameZone: vi.fn() }));
vi.mock("@/lib/sites/community", () => ({ siteCommunityInfo: summary, zoneCommunityInfo: vi.fn() }));
vi.mock("@/lib/sites/endorsements", () => ({ toggleSiteEndorsement: toggle, toggleZoneEndorsement: vi.fn() }));
vi.mock("./boundary-action", () => ({ getBoundaryForPublicRow: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("returns the persisted endorsement summary without refreshing unrelated pages and their replay", async () => {
  const info = { contributors: [], recentAudit: [], endorsement: { count: 2, hasEndorsed: true } };
  toggle.mockResolvedValue({ endorsed: true });
  summary.mockResolvedValue(info);
  expect(await toggleEndorsement("site", "ridge")).toEqual({ ok: true, endorsed: true, info });
  expect(toggle).toHaveBeenCalledWith("ridge", "pilot");
  expect(summary).toHaveBeenCalledWith("ridge", "pilot");
  expect(revalidate).not.toHaveBeenCalled();
});

it("still invalidates the pages whose displayed site names change after a rename", async () => {
  expect(await renamePublicRow("site", "ridge", "Renamed Ridge")).toEqual({ ok: true });
  expect(rename).toHaveBeenCalledWith("ridge", "pilot", "Renamed Ridge", "renamed ridge");
  expect(revalidate.mock.calls).toEqual([["/logbook"], ["/feed"]]);
});
