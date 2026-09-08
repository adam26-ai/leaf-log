import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlightListItem } from "@/lib/flights/repo";
import { LogbookList } from "./logbook-list";

vi.mock("./flight-row", () => ({ FlightRow: ({ flight }: { flight: FlightListItem }) => <a href={`/flights/${flight.id}`}>{flight.id}</a> }));
afterEach(cleanup);
const flights = [
  { id: "unknown", status: "ready", takeoffSiteId: null, takeoffSiteName: null, glider: "Wing A", durationS: 3600 },
  { id: "woodrat", status: "ready", takeoffSiteId: "site", takeoffSiteName: "Woodrat", glider: "Wing B", durationS: 7200 },
] as FlightListItem[];

it("selects a site, toggles the filter, and dismisses lists on outside touches or Escape", () => {
  render(<LogbookList flights={flights} trophies={{}} />);
  const sites = screen.getByRole("button", { name: "Select Sites" });
  fireEvent.click(sites);
  const choices = screen.getByRole("group", { name: "Sites choices" });
  fireEvent.click(within(choices).getByRole("button", { name: "None" }));
  fireEvent.click(within(choices).getByRole("checkbox", { name: "Unknown site (1)" }));
  expect(screen.getByRole("link", { name: "unknown" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "woodrat" })).not.toBeInTheDocument();
  expect(sites).toHaveAttribute("aria-expanded", "true");
  fireEvent.pointerDown(document.body, { pointerType: "touch" });
  expect(sites).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "Filter by site" }));
  expect(screen.getByRole("link", { name: "woodrat" })).toBeInTheDocument();
  fireEvent.click(sites);
  fireEvent.click(screen.getByRole("button", { name: "Select Wings" }));
  expect(screen.queryByRole("group", { name: "Sites choices" })).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Wings choices" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Wings choices" })).not.toBeInTheDocument();
});
