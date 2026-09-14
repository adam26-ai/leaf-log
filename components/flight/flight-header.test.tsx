import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Flight } from "@prisma/client";
import { FlightHeader } from "./flight-header";

vi.mock("./name-site-dialog", () => ({ SiteNameControl: ({ as, initialSiteName, endpoint }: { as?: string; initialSiteName: string; endpoint: string }) => as === "h1" ? <h1><button data-endpoint={endpoint}>{initialSiteName ?? "Site not recorded"}</button></h1> : <button data-endpoint={endpoint}>{initialSiteName}</button> }));
vi.mock("./replay-trophies", () => ({ ReplayTrophies: () => null }));
vi.mock("./type-flags", () => ({ FlightTypeBadges: () => null }));
afterEach(cleanup);
const flight = { id: "flight", flightDate: new Date("2026-08-01"), takeoffSiteName: "Main Ridge", takeoffSiteId: "main", landingSiteName: "Valley Field", landingSiteId: null, landingLat: null, landingLon: null } as Flight;

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
