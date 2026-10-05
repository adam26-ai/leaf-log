import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Flight } from "@prisma/client";
import { FlightHeader } from "./flight-header";

vi.mock("./name-site-dialog", () => ({ SiteNameControl: ({ as, initialSiteName, endpoint, needsReview }: { as?: string; initialSiteName: string; endpoint: string; needsReview: boolean }) => as === "h1" ? <h1><button data-endpoint={endpoint}>{initialSiteName ?? "Site not recorded"}</button></h1> : <button data-endpoint={endpoint}>{initialSiteName ?? (needsReview ? "Choose site" : "Site not recorded")}</button> }));
vi.mock("./replay-trophies", () => ({ ReplayTrophies: () => <span data-testid="trophies" /> }));
vi.mock("./type-flags", () => ({ FlightTypeBadges: () => null }));
afterEach(cleanup);
const flight = { id: "flight", flightDate: new Date("2026-08-01"), takeoffSiteName: "Main Ridge", takeoffSiteId: "main", landingSiteName: "Valley Field", landingSiteId: null, landingLat: null, landingLon: null } as Flight;

it("exposes an unresolved landing next to a named takeoff", () => {
  render(<FlightHeader flight={{ ...flight, landingSiteName: null, landingSiteAssignment: "needs_review" }} isOwner previousFlightId={null} nextFlightId={null} actions={null} />);
  expect(screen.getByRole("button", { name: "Choose site" })).toHaveAttribute("data-endpoint", "landing");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Main Ridge");
});

it("keeps an unnamed landing without a review request hidden", () => {
  render(<FlightHeader flight={{ ...flight, landingSiteName: null, landingSiteAssignment: "unassigned" }} isOwner previousFlightId={null} nextFlightId={null} actions={null} />);
  expect(screen.queryByText("Choose site")).not.toBeInTheDocument();
  expect(screen.queryByText("Site not recorded")).not.toBeInTheDocument();
});

it("keeps the site control mounted when a server refresh updates its name", () => {
  const { rerender } = render(<FlightHeader flight={flight} isOwner={false} previousFlightId={null} nextFlightId={null} actions={null} />);
  const control = screen.getByRole("button", { name: "Main Ridge" });
  rerender(<FlightHeader flight={{ ...flight, takeoffSiteName: "Renamed Ridge" }} isOwner={false} previousFlightId={null} nextFlightId={null} actions={null} />);
  expect(screen.getByRole("button", { name: "Renamed Ridge" })).toBe(control);
});

it("shows an editable name-only landing without GPS, below the primary site's emphasis", () => {
  render(<FlightHeader flight={flight} isOwner previousFlightId={null} nextFlightId={null} actions={null} />);
  expect(within(screen.getByRole("heading", { level: 1 })).getByRole("button", { name: "Main Ridge" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Valley Field" })).toHaveAttribute("data-endpoint", "landing");
});

it("uses the landing name as the title when it is the only site", () => {
  render(<FlightHeader flight={{ ...flight, takeoffSiteName: null, takeoffSiteId: null }} isOwner previousFlightId={null} nextFlightId={null} actions={null} />);
  expect(within(screen.getByRole("heading", { level: 1 })).getByRole("button", { name: "Valley Field" })).toHaveAttribute("data-endpoint", "landing");
  expect(screen.queryByText("Site not recorded")).not.toBeInTheDocument();
});

it("places trophies after both site names", () => {
  render(<FlightHeader flight={flight} isOwner previousFlightId={null} nextFlightId={null} actions={null} />);
  expect(screen.getByRole("button", { name: "Valley Field" }).nextElementSibling).toBe(screen.getByTestId("trophies"));
});
