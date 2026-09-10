import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlightListItem } from "@/lib/flights/repo";
import { LogbookList } from "./logbook-list";

vi.mock("./flight-row", () => ({ FlightRow: ({ flight }: { flight: FlightListItem }) => <a href={`/flights/${flight.id}`}>{flight.id}</a> }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
const flights = [
  { id: "unknown", status: "ready", takeoffSiteId: null, takeoffSiteName: null, glider: "Wing A", durationS: 3600 },
  { id: "woodrat", status: "ready", takeoffSiteId: "site", takeoffSiteName: "Woodrat", glider: "Wing B", durationS: 7200 },
] as FlightListItem[];

it("combines icon and choices, clears with All, and dismisses lists on outside touches or Escape", () => {
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
  fireEvent.click(sites);
  fireEvent.click(within(screen.getByRole("group", { name: "Sites choices" })).getByRole("button", { name: "All" }));
  expect(screen.getByRole("link", { name: "woodrat" })).toBeInTheDocument();
  expect(sites).not.toHaveClass("bg-brand-blue");
  fireEvent.click(screen.getByRole("button", { name: "Select Wings" }));
  expect(screen.queryByRole("group", { name: "Sites choices" })).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Wings choices" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Wings choices" })).not.toBeInTheDocument();
});

it("restores filters after leaving, deleting a flight, and remounting, scoped to the pilot", () => {
  const { unmount } = render(<LogbookList ownerId="pilot-a" flights={flights} trophies={{}} />);
  fireEvent.click(screen.getByRole("button", { name: "Select Wings" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Wing B (2h 00m)" }));
  unmount();
  const second = render(<LogbookList ownerId="pilot-a" flights={[...flights, { ...flights[0], id: "another" }]} trophies={{}} />);
  expect(screen.queryByRole("link", { name: "woodrat" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "another" })).toBeInTheDocument();
  second.unmount();
  const third = render(<LogbookList ownerId="pilot-a" flights={[flights[1]]} trophies={{}} />);
  expect(screen.getByText("No flights match these filters.")).toBeInTheDocument();
  third.unmount();
  render(<LogbookList ownerId="pilot-b" flights={flights} trophies={{}} />);
  expect(screen.getByRole("link", { name: "woodrat" })).toBeInTheDocument();
});

it("intersects local inclusive dates and trophy categories without reranking", () => {
  render(<LogbookList flights={flights.map((flight, index) => ({ ...flight, takeoffAt: new Date(`2026-09-${index ? "11" : "10"}T01:00:00Z`), localUtcOffsetMinutes: -420 }))} trophies={{ unknown: [{ category: "altitude", rank: 2, value: 1500, approximate: false }] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Select Dates" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-09" } });
  fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-09-09" } });
  expect(screen.queryByRole("link", { name: "woodrat" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Select Trophies" }));
  fireEvent.click(screen.getByLabelText("Highest altitude (MSL)"));
  expect(screen.getByRole("link", { name: "unknown" })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Longest duration"));
  expect(screen.getByText("No flights match these filters.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByRole("link")).toHaveLength(2);
});

it("loads shared flights only when needed and restores a selected friend", async () => {
  sessionStorage.setItem("leaf-logbook-filters:v1:pilot", JSON.stringify({ friends: ["alice"] }));
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ friends: [{ key: "alice", label: "Alice", flightIds: ["unknown"] }, { key: "ben", label: "Ben", flightIds: ["woodrat"] }] }) }));
  vi.stubGlobal("fetch", fetch);
  render(<LogbookList ownerId="pilot" flights={flights} trophies={{}} />);
  await waitFor(() => expect(screen.getByRole("link", { name: "unknown" })).toBeInTheDocument());
  expect(screen.queryByRole("link", { name: "woodrat" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
});

it("keeps the only friend selected instead of treating that selection as all flights", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ friends: [{ key: "alice", label: "Alice", flightIds: ["unknown"] }] }) })));
  render(<LogbookList flights={flights} trophies={{}} />);
  fireEvent.click(screen.getByRole("button", { name: "Select Friends" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alice" }));
  expect(screen.getByRole("link", { name: "unknown" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "woodrat" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Select Friends" })).toHaveClass("bg-brand-blue");
});
