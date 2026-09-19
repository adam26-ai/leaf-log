import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationCommunityDialog } from "./location-community-dialog";

const { load, toggle, refresh } = vi.hoisted(() => ({ load: vi.fn(), toggle: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/flights/[id]/community-action", () => ({ getCommunityDialogData: load, toggleEndorsement: toggle, getCommunityInfoForRow: refresh }));
vi.mock("@/app/flights/[id]/boundary-action", () => ({}));
vi.mock("./persisted-site-editor", () => ({ PersistedSiteEditor: () => null }));
vi.mock("./site-area-map", () => ({ SiteAreaMap: () => <div data-testid="site-area-map" /> }));
vi.mock("./boundary-editor", () => ({ BoundaryEditor: () => null }));

const info = (count: number, hasEndorsed: boolean) => ({ contributors: [], recentAudit: [], endorsement: { count, hasEndorsed } });
beforeEach(() => load.mockResolvedValue({ boundary: null, info: info(0, false) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<LocationCommunityDialog level="site" id="ridge" name="Ridge" endpoint="takeoff" onClose={() => {}} />);
  return screen.findByRole("button", { name: "Endorse" });
}

it("keeps endorsement pending until the authoritative updated summary arrives, without another read", async () => {
  let finish!: (result: unknown) => void;
  toggle.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const button = await open();
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(screen.getByText("0 endorsements")).toBeVisible();
  finish({ ok: true, endorsed: true, info: info(1, true) });
  expect(await screen.findByText("1 endorsement")).toBeVisible();
  expect(screen.getByRole("button", { name: /Endorsed/ })).toBeEnabled();
  expect(refresh).not.toHaveBeenCalled();
});

it("preserves the count and enables retry when an endorsement request fails", async () => {
  toggle.mockRejectedValue(new Error("network unavailable"));
  const button = await open();
  fireEvent.click(button);
  expect(await screen.findByText("Could not update the endorsement. Please try again.")).toBeVisible();
  expect(button).toBeEnabled();
  expect(screen.getByText("0 endorsements")).toBeVisible();
});

it("reports a failed initial load instead of leaving an unhandled rejection and loading forever", async () => {
  load.mockRejectedValue(new Error("network unavailable"));
  render(<LocationCommunityDialog level="site" id="ridge" name="Ridge" endpoint="takeoff" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText("Could not load site details. Close and reopen to retry.")).toBeVisible());
  expect(screen.queryByRole("button", { name: "Endorse" })).not.toBeInTheDocument();
});

it("shows the endorsement summary before constructing the area map", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  load.mockResolvedValueOnce({
    boundary: { anchor: { lat: 33, lon: -147 }, boundary: null, nearby: [] },
    info: info(1, false),
  });

  render(<LocationCommunityDialog level="site" id="ridge" name="Ridge" endpoint="takeoff" onClose={() => {}} />);
  expect(await screen.findByText("1 endorsement")).toBeVisible();
  expect(screen.queryByTestId("site-area-map")).not.toBeInTheDocument();

  while (frames.length) {
    await act(async () => { frames.shift()?.(0); });
  }
  expect(screen.getByTestId("site-area-map")).toBeVisible();
});
