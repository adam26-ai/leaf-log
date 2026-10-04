import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiteManager } from "./site-manager";
import type { ReactNode } from "react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({}));
vi.mock("./site-flight-list", () => ({ SiteFlightList: () => null, SiteFlightSummary: () => null }));
vi.mock("@/components/flight/persisted-site-editor", () => ({ PersistedSiteEditor: () => null }));
vi.mock("@/components/sites/site-map-panel", () => ({ SiteMapPanel: ({ onSelect, heading, actions, children }: { onSelect: (id: string) => void; heading: string; actions: ReactNode; children: ReactNode }) => <section data-testid="site-map"><h2>{heading}</h2>{actions}<button onClick={() => onSelect("outside")}>Map selection</button>{children}</section> }));
afterEach(cleanup);
const sites = [
  { id: "a", name: "Alpine", kind: "both" as const, visibility: "public", lat: 45, lon: 6, updatedAt: "today", hasBoundary: false, ownFlightCount: 12 },
  { id: "b", name: "Valley", kind: "both" as const, visibility: "private", lat: null, lon: null, updatedAt: "today", hasBoundary: false, ownFlightCount: 2 },
];
it("lists public sites outside the logbook for an admin and enables authorized deletion", () => {
  render(<SiteManager includePublicSites sites={[{ ...sites[0], inLogbook: false, canDelete: true }]} />);
  expect(screen.getByRole("heading", { name: "Your sites and public sites" })).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Sites list" })).getByRole("button", { name: /Alpine/ })).toBeVisible();
  expect(screen.getByRole("button", { name: "Delete site" })).toBeEnabled();
});
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
  expect(screen.queryByRole("button", { name: "Delete site" })).not.toBeInTheDocument();
  expect(screen.getAllByTestId("site-map")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Site map" })).toBeInTheDocument();
});

it("selects a public site outside the logbook from the map, clearing conflicting filters", () => {
  render(<SiteManager sites={[...sites, { ...sites[0], id: "outside", name: "New ridge", inLogbook: false, ownFlightCount: 0, canDelete: false }]} />);
  const list = within(screen.getByRole("region", { name: "Sites list" }));
  expect(list.queryByRole("button", { name: /New ridge/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search sites"), { target: { value: "missing" } });
  fireEvent.change(screen.getByLabelText("Filter site visibility"), { target: { value: "private" } });
  fireEvent.click(screen.getByRole("button", { name: "Map selection" }));
  expect(list.getByRole("button", { name: /New ridge/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "New ridge" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete site" })).toBeDisabled();
  expect(screen.getByLabelText("Search sites")).toHaveValue("");
  expect(list.getByText("From map")).toBeInTheDocument();
});
