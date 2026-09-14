import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiteNameControl } from "./name-site-dialog";

const { save, refresh } = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/flights/[id]/site-action", () => ({
  nameSite: save,
  getSiteDialogData: async () => ({ info: { site: null, zone: null, flightPoint: null }, suggestions: [{ id: "new", name: "New Ridge", visibility: "private", kind: "both", zones: [] }] }),
}));
vi.mock("@/app/flights/[id]/boundary-action", () => ({}));
vi.mock("@/app/settings/sites/editor-actions", () => ({}));
vi.mock("./persisted-site-editor", () => ({ PersistedSiteEditor: () => <div>New site editor</div> }));
vi.mock("@/components/flight/boundary-editor", () => ({ BoundaryEditor: () => null }));
vi.mock("@/components/flight/location-community-dialog", () => ({ LocationCommunityDialog: () => null }));
vi.mock("@/components/flight/site-area-map", () => ({ SiteAreaMap: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openChooser(zonesEnabled = false) {
  render(<SiteNameControl flightId="flight" endpoint="takeoff" initialSiteName="Old Ridge" initialZoneName={null} siteId={null} zoneId={null} isOwner zonesEnabled={zonesEnabled} needsReview />);
  fireEvent.click(screen.getByRole("button", { name: "Old Ridge" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose a different site" }));
  await screen.findByRole("button", { name: "Use this site" });
}

it("requires a nonblank name before opening the create flow", async () => {
  await openChooser();
  const create = screen.getByRole("button", { name: "Create site" });
  expect(create).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText("e.g. Sonoma Ridge"), { target: { value: "   " } });
  expect(create).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText("e.g. Sonoma Ridge"), { target: { value: "My Ridge" } });
  fireEvent.click(create);
  expect(screen.getByText("New site editor")).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it.each([false, true])("saves and closes an existing site with zones enabled: %s", async zones => {
  save.mockResolvedValue({ ok: true, siteName: "New Ridge", zoneName: null });
  await openChooser(zones);
  fireEvent.click(screen.getByRole("button", { name: "Use this site" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledWith({ flightId: "flight", endpoint: "takeoff", site: { mode: "reuse", id: "new" }, zone: undefined });
  expect(screen.getByRole("button", { name: "New Ridge" })).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();
});

it("keeps the dialog open and allows retry when saving fails", async () => {
  save.mockRejectedValue(new Error("Offline"));
  await openChooser();
  fireEvent.click(screen.getByRole("button", { name: "Use this site" }));
  expect(await screen.findByText("Could not save the site. Please try again.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use this site" })).toBeEnabled();
});
