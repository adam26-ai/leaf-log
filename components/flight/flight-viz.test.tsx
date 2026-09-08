import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LoadedReplayFlight } from "./use-group-replay";
import { toggleReplayXcRoute } from "@/lib/flights/replay-events";

const { group } = vi.hoisted(() => {
  const pilot = { id: "self", handle: "self", displayName: "Self", avatarUpdatedAt: null };
  const flight = { id: "flight", owner: pilot, takeoffMs: 100000, landingMs: 200000, xcScore: { version: 1, best: { shape: "open", distanceM: 10000, optimal: true }, candidates: [] },
    replay: { takeoffMs: 100000, durationS: 100, offsetMin: 0, altSource: "gps", bounds: [0,0,1,1], samples: [[0,0,100,0],[0.001,0,200,10],[0.01,0,100,100]], vario: [0,1,0] },
    photos: [{ id: "photo", flightId: "flight", originalFilename: "test-photo.jpg", tSec: 5, takenAt: new Date(105000).toISOString(), placementSource: "interpolated_time", lat: 0, lon: 0 }] };
  return { group: { flights: [flight], visibleFlights: [flight], selected: flight, primaryReplay: flight.replay, candidates: [flight], pilots: [pilot], bounds: { startMs: 100000, endMs: 200000 }, failures: [], photoFailures: [], isVisible: () => true, select: vi.fn(), toggle: vi.fn(), discover: vi.fn(), reloadPhotos: vi.fn() } };
});
vi.mock("./use-group-replay", () => ({ useGroupReplay: () => group }));
vi.mock("./flight-replay-3d", () => ({ FlightReplay3D: ({ trackDisplay, onPhotoOpen, xcRoute }: { trackDisplay: string; onPhotoOpen: (id: string) => void; xcRoute: unknown }) => <div data-testid="replay" data-track={trackDisplay} data-xc={Boolean(xcRoute)}><button onClick={() => onPhotoOpen("photo")}>Map photo</button></div> }));
vi.mock("./barograph", () => ({ BAROGRAPH_PLOT_LEFT_INSET: 40, BAROGRAPH_PLOT_RIGHT_INSET: 10, Barograph: () => null }));
import { FlightViz } from "./flight-viz";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
function view() {
  const flight = group.selected as unknown as LoadedReplayFlight;
  render(<FlightViz flightId={flight.id} primaryPilot={flight.owner} viewerId="self" takeoffMs={100000} offsetMin={0} />);
}
it("toggles the scored route without seeking or changing pilot", () => {
  view();
  expect(screen.getByTestId("replay")).toHaveAttribute("data-xc", "true");
  act(() => toggleReplayXcRoute());
  expect(screen.getByTestId("replay")).toHaveAttribute("data-xc", "false");
  act(() => toggleReplayXcRoute());
  expect(screen.getByTestId("replay")).toHaveAttribute("data-xc", "true");
  expect(screen.getByRole("slider", { name: "Flight playback time" })).toHaveAttribute("aria-valuenow", "0");
  expect(group.select).not.toHaveBeenCalled();
});
it("opens photos without moving the timeline, selecting a pilot, or stopping playback", () => {
  vi.useFakeTimers(); view();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  act(() => vi.advanceTimersByTime(100));
  const before = screen.getByRole("slider", { name: "Flight playback time" }).getAttribute("aria-valuenow");
  fireEvent.click(screen.getByRole("button", { name: "Map photo" }));
  expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Flight playback time" })).toHaveAttribute("aria-valuenow", before);
  expect(group.select).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
});
it("keeps focused flyouts available when the pointer leaves and applies the chosen map", () => {
  view();
  const control = screen.getByRole("button", { name: "Basemap: Map (click to cycle, hover for options)" });
  act(() => control.focus());
  fireEvent.mouseLeave(control.parentElement!);
  const option = screen.getByRole("button", { name: "Map" });
  expect(option.parentElement!.parentElement).toHaveClass("visible");
  fireEvent.click(option);
  expect(option.parentElement!.parentElement).toHaveClass("invisible");
  expect(screen.getByRole("button", { name: "Basemap: Map (click to cycle, hover for options)" })).toBeInTheDocument();
});
it("starts elapsed-track rendering on scrub and previews crossed photos for four real seconds", () => {
  vi.useFakeTimers(); view();
  expect(screen.getByTestId("replay")).toHaveAttribute("data-track", "full");
  fireEvent.keyDown(screen.getByRole("slider", { name: "Flight playback time" }), { key: "ArrowRight" });
  expect(screen.getByTestId("replay")).toHaveAttribute("data-track", "elapsed");
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  // Advance in individual frames so the crossing effect observes progress.
  for (let i = 0; i < 50; i++) act(() => vi.advanceTimersByTime(16));
  expect(screen.getByRole("button", { name: "Open test-photo.jpg" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(4100));
  expect(screen.queryByRole("button", { name: "Open test-photo.jpg" })).not.toBeInTheDocument();
});
