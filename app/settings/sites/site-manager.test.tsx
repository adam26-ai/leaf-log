import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiteManager } from "./site-manager";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({}));
vi.mock("./site-flight-list", () => ({ SiteFlightList: () => null, SiteFlightSummary: () => null }));
vi.mock("@/components/flight/persisted-site-editor", () => ({ PersistedSiteEditor: () => null }));
vi.mock("@/components/flight/site-area-map", () => ({ SiteAreaMap: () => <div data-testid="site-map" /> }));
afterEach(cleanup);
const sites = [
  { id: "a", name: "Alpine", kind: "both" as const, visibility: "public", lat: 45, lon: 6, updatedAt: "today", hasBoundary: false, ownFlightCount: 12 },
  { id: "b", name: "Valley", kind: "both" as const, visibility: "private", lat: null, lon: null, updatedAt: "today", hasBoundary: false, ownFlightCount: 2 },
];
it("highlights the selected row and filters visibility, mapping and name together", () => {
  render(<SiteManager sites={sites} />);
  const list = within(screen.getByRole("region", { name: "Sites list" }));
  expect(list.getByRole("button", { name: /Alpine/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("site-map")).toBeInTheDocument();
  fireEvent.click(list.getByRole("button", { name: /Valley/ }));
  expect(list.getByRole("button", { name: /Valley/ })).toHaveAttribute("aria-pressed", "true");
  expect(list.getByText("Not mapped")).toHaveClass("text-orange-700");
  fireEvent.change(screen.getByLabelText("Filter site visibility"), { target: { value: "private" } });
  fireEvent.change(screen.getByLabelText("Filter site mapping"), { target: { value: "unmapped" } });
  expect(list.queryByRole("button", { name: /Alpine/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search sites"), { target: { value: "missing" } });
  expect(list.getByText("No sites match these filters.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit site" })).not.toBeInTheDocument();
});
