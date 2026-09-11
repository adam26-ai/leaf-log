import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LoadedReplayFlight } from "./use-group-replay";
import type { FlightStatistics } from "@/lib/flights/statistics";
import { toggleReplayXcRoute } from "@/lib/flights/replay-events";

const { group } = vi.hoisted(() => {
  const pilot = { id: "self", handle: "self", displayName: "Self", avatarUpdatedAt: null };
  const flight = { id: "flight", owner: pilot, takeoffMs: 100000, landingMs: 200000, xcScore: { version: 1, best: { shape: "open", distanceM: 10000, optimal: true }, candidates: [] },
    replay: { takeoffMs: 100000, durationS: 100, offsetMin: 0, altSource: "gps", bounds: [0,0,1,1], samples: [[0,0,100,0],[0.001,0,200,10],[0.01,0,100,100]], vario: [0,1,0] },
    photos: [{ id: "photo", flightId: "flight", originalFilename: "test-photo.jpg", tSec: 5, takenAt: new Date(105000).toISOString(), placementSource: "interpolated_time", lat: 0, lon: 0 }] };
  return { group: { flights: [flight], visibleFlights: [flight], selected: flight, primaryReplay: flight.replay, candidates: [flight], pilots: [pilot], bounds: { startMs: 100000, endMs: 200000 }, failures: [], photoFailures: [], isVisible: () => true, select: vi.fn(), toggle: vi.fn(), discover: vi.fn(), reloadPhotos: vi.fn() } };
});
vi.mock("./use-group-replay", () => ({ useGroupReplay: () => group }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/flights/queue-xc-action", () => ({ queueFlightXc: vi.fn(), queueMissingFlightAnalysis: vi.fn() }));
vi.mock("./flight-replay-3d", () => ({ FlightReplay3D: ({ trackDisplay, onPhotoOpen, xcRoute, pilotName }: { trackDisplay: string; onPhotoOpen: (id: string) => void; xcRoute: unknown; pilotName: string }) => <div data-testid="replay" data-track={trackDisplay} data-xc={Boolean(xcRoute)} data-pilot={pilotName}><button onClick={() => onPhotoOpen("photo")}>Map photo</button></div> }));
vi.mock("./barograph", () => ({ BAROGRAPH_PLOT_LEFT_INSET: 40, BAROGRAPH_PLOT_RIGHT_INSET: 10, Barograph: ({ profiles }: { profiles: { id: string; state: string }[] }) => <div>{profiles.map((profile) => <span key={profile.id} data-testid={`profile-${profile.id}`} data-state={profile.state} />)}</div> }));
import { FlightViz } from "./flight-viz";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
function view() {
  const flight = group.selected as unknown as LoadedReplayFlight;
  render(<FlightViz flightId={flight.id} primaryPilot={flight.owner} viewerId="self" takeoffMs={100000} offsetMin={0} />);
}
it("offers the day calendar for a single own flight even when no companions are detected", () => {
  view();
  expect(screen.queryByLabelText("Pilots in this replay")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^(Show|Hide) friends$/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh friends" }));
  expect(group.discover).toHaveBeenCalledOnce();
  const slider = screen.getByRole("slider", { name: "Flight playback time" });
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: "Relive the day" }));
  expect(group.discover).toHaveBeenLastCalledWith(false, true);
  expect(slider).toHaveAttribute("aria-valuenow", "1");
});
it("labels the selected glider with its owner's profile, using the handle when the display name is blank", () => {
  view();
  expect(screen.getByTestId("replay")).toHaveAttribute("data-pilot", "Self");
  cleanup();
  const original = group.selected;
  try {
    group.selected = { ...original, owner: { ...original.owner, handle: "friend", displayName: "" } };
    view();
    expect(screen.getByTestId("replay")).toHaveAttribute("data-pilot", "friend");
  } finally { group.selected = original; }
});
it("starts with the scored route hidden and toggles it without seeking or changing pilot", () => {
  view();
  expect(screen.getByTestId("replay")).toHaveAttribute("data-xc", "false");
  act(() => toggleReplayXcRoute());
  expect(screen.getByTestId("replay")).toHaveAttribute("data-xc", "true");
  act(() => toggleReplayXcRoute());
  expect(screen.getByTestId("replay")).toHaveAttribute("data-xc", "false");
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
it("opens flyouts without cycling on touch and dismisses them when the map is touched", () => {
  view();
  const control = screen.getByRole("button", { name: "Basemap: Map (click to cycle, hover for options)" });
  fireEvent.pointerDown(control, { pointerType: "touch" });
  fireEvent.click(control);
  const option = screen.getByRole("button", { name: "Map" });
  expect(option.parentElement!.parentElement).toHaveClass("visible");
  expect(screen.getByRole("button", { name: "Basemap: Map (click to cycle, hover for options)" })).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByTestId("replay"), { pointerType: "touch" });
  expect(option.parentElement!.parentElement).toHaveClass("invisible");
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

it("shows all selected friend's profiles, ghosts our flight, and uses timeline takeoffs without a flight picker", () => {
  const original = { ...group };
  const own = group.flights[0];
  const pilot = { ...own.owner, id: "friend", handle: "friend", displayName: "Friend" };
  const first = { ...own, id: "friend-first", owner: pilot, takeoffMs: 140000, landingMs: 240000, photos: [], replay: { ...own.replay, takeoffMs: 140000 } };
  const second = { ...first, id: "friend-second", takeoffMs: 260000, landingMs: 360000, replay: { ...first.replay, takeoffMs: 260000 } };
  Object.assign(group, { flights: [own, second, first], visibleFlights: [own, second, first], candidates: [own, second, first], pilots: [own.owner, pilot], selected: first, bounds: { startMs: 100000, endMs: 360000 } });
  try {
    render(<FlightViz flightId={own.id} primaryPilot={own.owner} viewerId="self" takeoffMs={100000} offsetMin={0} />);
    expect(screen.queryByRole("combobox", { name: "Friend flight" })).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-friend-first")).toHaveAttribute("data-state", "friendSelected");
    expect(screen.getByTestId("profile-friend-second")).toHaveAttribute("data-state", "friendSelected");
    expect(screen.getByTestId("profile-flight")).toHaveAttribute("data-state", "ownUnselected");
    const takeoffs = screen.getAllByRole("button", { name: /Jump to Friend's takeoff at/ });
    for (const [takeoff, id, time] of [[takeoffs[0], first.id, "40"], [takeoffs[1], second.id, "160"], [takeoffs[0], first.id, "40"]] as const) {
      fireEvent.click(takeoff);
      expect(group.select).toHaveBeenLastCalledWith(pilot, id);
      expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", time);
    }
    const ticks = document.querySelectorAll("[data-takeoff-flight]");
    expect(ticks).toHaveLength(3);
  } finally { Object.assign(group, original); }
});

it("shows the selected flight's statistics and seeks that flight's metrics on the shared timeline", () => {
  const original = { ...group };
  const own = group.flights[0];
  const ownStats: FlightStatistics = { id: own.id, glider: "Own wing", durationS: 100, maxAltM: 200,
    altGainM: 100, maxClimbMs: 1, maxSinkMs: -1, status: "ready", xcStatus: "unscored",
    xcError: null, metricsVersion: METRICS_VERSION, xcScore: null };
  const pilot = { ...own.owner, id: "friend", handle: "friend", displayName: "Friend" };
  const first = { ...own, id: "friend-first", owner: pilot, takeoffMs: 300000, landingMs: 400000,
    statistics: { ...ownStats, id: "friend-first", glider: "First friend wing", maxAltM: 500 },
    replay: { ...own.replay, takeoffMs: 300000, samples: [[0,0,100,0],[0,0,500,60],[0,0,100,100]], vario: [0,3,-2] } };
  const second = { ...first, id: "friend-second", takeoffMs: 500000, landingMs: 600000,
    statistics: { ...first.statistics, id: "friend-second", glider: "Second friend wing" },
    replay: { ...first.replay, takeoffMs: 500000 } };
  Object.assign(group, { flights: [own, first, second], visibleFlights: [own, first, second],
    candidates: [own, first, second], pilots: [own.owner, pilot], selected: first, bounds: { startMs: 100000, endMs: 600000 } });
  const props = { flightId: own.id, primaryPilot: own.owner, viewerId: "self", takeoffMs: 100000, offsetMin: 0, primaryStatistics: ownStats };
  try {
    const { rerender } = render(<FlightViz {...props} />);
    expect(screen.getByText("First friend wing").closest("[data-statistics-flight]"))
      .toHaveAttribute("data-statistics-pilot", "friend");
    expect(screen.queryByText("Own wing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Max altitude/i }));
    expect(group.select).toHaveBeenLastCalledWith(pilot, first.id);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "260");
    group.selected = second;
    rerender(<FlightViz {...props} />);
    expect(screen.getByText("Second friend wing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Best climb/i }));
    expect(group.select).toHaveBeenLastCalledWith(pilot, second.id);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "460");
    group.selected = own;
    rerender(<FlightViz {...props} />);
    expect(screen.getByText("Own wing").closest("[data-statistics-flight]"))
      .toHaveAttribute("data-statistics-pilot", "own");
  } finally { Object.assign(group, original); }
});
