import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlightListItem } from "@/lib/flights/repo";
import { FlightRow } from "./flight-row";

vi.mock("@/components/flight/analysis-status", () => ({ AnalysisStatus: () => null }));

afterEach(cleanup);

const flight = {
  id: "flight-1",
  source: "manual_upload",
  status: "ready",
  visibility: "public",
  flightDate: new Date("2026-09-01T00:00:00Z"),
  takeoffAt: new Date("2026-09-01T18:00:00Z"),
  localUtcOffsetMinutes: -420,
  durationS: 3600,
  maxAltM: 1800,
  takeoffSiteName: "Woodrat",
  takeoffSiteId: "woodrat",
  takeoffZoneName: null,
  takeoffZoneId: null,
  landingSiteName: null,
  landingSiteId: null,
  landingZoneName: null,
  landingZoneId: null,
} as FlightListItem;

it.each([
  ["public", "globe"],
  ["friends", "users"],
  ["private", "lock"],
] as const)("uses an eye and %s scope icon for compact visibility", (scope, icon) => {
  render(<FlightRow flight={{ ...flight, visibility: scope }} compact />);

  const label = scope[0].toUpperCase() + scope.slice(1);
  const visibility = screen.getByLabelText(`Visibility: ${label}`);
  expect(visibility).toHaveAttribute("title", `Visibility: ${label}`);
  expect(within(visibility).queryByText(label)).not.toBeInTheDocument();
  expect(visibility.querySelectorAll("svg")).toHaveLength(2);
  expect(visibility.querySelector(".lucide-eye")).toBeInTheDocument();
  expect(visibility.querySelector(`.lucide-${icon}`)).toBeInTheDocument();
});

it("shows a blue paraglider-and-friends pill for companion matches", () => {
  render(<FlightRow flight={flight} compact friendFlightsFound />);
  const companions = screen.getByLabelText("Friend flights found");
  expect(companions).toHaveClass("bg-brand-blue");
  expect(companions.querySelectorAll("svg")).toHaveLength(2);
  const companionColumn = companions.parentElement;
  expect(companionColumn).toHaveClass("w-11", "justify-center");
  const siteAltitudeGroup = screen.getByTitle("Woodrat").parentElement;
  expect(screen.getByTitle("Maximum altitude").parentElement).toBe(siteAltitudeGroup);
  expect(siteAltitudeGroup?.nextElementSibling).toBe(companionColumn);
});

it("reserves the companion column for flights without a match", () => {
  render(<FlightRow flight={flight} compact />);
  const siteAltitudeGroup = screen.getByTitle("Woodrat").parentElement;
  const companionColumn = siteAltitudeGroup?.nextElementSibling;
  expect(companionColumn).toHaveClass("w-11");
  expect(companionColumn).toBeEmptyDOMElement();
  expect(screen.getByTitle("Maximum altitude").parentElement).toBe(siteAltitudeGroup);
});
