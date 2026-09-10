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

it("toggles trophy flights while preserving other filters", () => {
  render(<LogbookList flights={flights} trophies={{ unknown: [{ category: "altitude", rank: 2, value: 1500, approximate: false }] }} />);
  const toggle = screen.getByRole("button", { name: "Trophies" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "unknown" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Trophies choices" })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Select Wings" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Wing A (1h 00m)" }));
  fireEvent.click(toggle);
  expect(screen.getByText("No flights match these filters.")).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole("link", { name: "woodrat" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "unknown" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("2 of 2 flights")).toBeInTheDocument();
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

it("filters by selected friends and restores all flights after unchecking the last friend", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ friends: [{ key: "alice", label: "Alice", flightIds: ["unknown"] }, { key: "ben", label: "Ben", flightIds: ["woodrat"] }] }) })));
  render(<LogbookList flights={[...flights, { ...flights[0], id: "solo" }]} trophies={{}} />);
  const trigger = screen.getByRole("button", { name: "Select Friends" });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alice" }));
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "unknown" })).toBeInTheDocument();
  expect(trigger).toHaveClass("bg-brand-blue");
  fireEvent.click(screen.getByRole("checkbox", { name: "Ben" }));
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.queryByRole("link", { name: "solo" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
  expect(screen.getAllByRole("link")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Ben" }));
  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(trigger).not.toHaveClass("bg-brand-blue");
  expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "No shared flights" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getAllByRole("link")).toHaveLength(3);
});

it("restores retired empty friend and no-trophy selections as inactive filters", () => {
  sessionStorage.setItem("leaf-logbook-filters:v1:pilot", JSON.stringify({ friends: ["__no_shared_flights__"], trophies: ["none"] }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<LogbookList ownerId="pilot" flights={flights} trophies={{}} />);
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Trophies" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
