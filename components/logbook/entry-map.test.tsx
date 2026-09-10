import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EntryMap } from "./entry-map";

const map = vi.hoisted(() => ({
  easeTo: vi.fn(), fitBounds: vi.fn(), on: vi.fn(), getCanvas: vi.fn(() => ({ focus: vi.fn() })),
  addControl: vi.fn(), remove: vi.fn(), resize: vi.fn(), getZoom: vi.fn(() => 11),
}));
const markers = vi.hoisted(() => [] as { color: string; element: HTMLElement; setLngLat: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[]);
vi.mock("maplibre-gl", () => ({ default: {
  Map: class { constructor() { return map; } },
  NavigationControl: class {},
  Marker: class {
    color: string;
    element = document.createElement("div");
    setLngLat = vi.fn(() => this);
    remove = vi.fn();
    constructor({ color }: { color: string }) { this.color = color; markers.push(this); }
    addTo() { return this; }
    getElement() { return this.element; }
  },
} }));

const site = { id: "site", name: "Mont Salève", lat: 46.12, lon: 6.17, previous: true };
const city = { id: "city", place_name: "Annecy, Haute-Savoie, France", center: [6.13, 45.9], bbox: [6.06, 45.85, 6.17, 45.95] };
const response = (features: unknown[]) => ({ ok: true, json: async () => ({ features }) });

beforeEach(() => {
  vi.clearAllMocks();
  markers.length = 0;
  vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "test-key");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("searches on Enter without submitting the flight and only moves the map until a map click", async () => {
  const fetch = vi.fn().mockResolvedValue(response([city]));
  vi.stubGlobal("fetch", fetch);
  const submit = vi.fn(event => event.preventDefault());
  const onPick = vi.fn();
  render(<form onSubmit={submit}><EntryMap lat={null} lon={null} onPick={onPick} /><button>Save flight</button></form>);
  const input = screen.getByRole("searchbox", { name: "Find a place" });
  fireEvent.change(input, { target: { value: "Annecy France" } });
  expect(fetch).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  const result = await screen.findByRole("button", { name: city.place_name });
  expect(fetch.mock.calls[0][0]).toContain("Annecy%20France.json?");
  fireEvent.click(result);
  expect(submit).not.toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
  expect(map.fitBounds).toHaveBeenCalledWith(city.bbox, expect.objectContaining({ maxZoom: 13 }));
  const click = map.on.mock.calls.find(([name]) => name === "click")![1];
  act(() => click({ lngLat: { lat: 45.91234567, wrap: () => ({ lng: 6.12345678 }) } }));
  expect(onPick).toHaveBeenCalledWith(45.912346, 6.123457);
});

it("matches known sites without accents and keeps them available when worldwide search fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  const onPick = vi.fn();
  render(<EntryMap lat={null} lon={null} sites={[site]} onPick={onPick} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "saleve" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText(/Place search is unavailable right now/);
  fireEvent.click(screen.getByRole("button", { name: /Mont Salève/ }));
  expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [6.17, 46.12] }));
  expect(onPick).not.toHaveBeenCalled();
});

it("supports known-site search without an API key and doesn't fetch", async () => {
  vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<EntryMap lat={null} lon={null} sites={[site]} onPick={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "saleve" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.getByRole("button", { name: /Mont Salève/ })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("discards stale results after editing the query and aborts requests on unmount", async () => {
  let finish!: (value: unknown) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response([city]));
  vi.stubGlobal("fetch", fetch);
  const { unmount } = render(<EntryMap lat={null} lon={null} onPick={vi.fn()} />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "Old query" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "Annecy" } });
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByRole("button", { name: city.place_name });
  await act(async () => finish(response([{ ...city, id: "old", place_name: "Old result" }])));
  expect(screen.queryByRole("button", { name: "Old result" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: city.place_name })).toBeInTheDocument();
  unmount();
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
});

it("handles empty results and ignores invalid coordinates and bounding boxes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([
    { ...city, id: "invalid", center: [200, 100] },
    { ...city, bbox: [6, 46, 5, 45] },
  ])));
  render(<EntryMap lat={null} lon={null} onPick={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Annecy" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText(/No places found/);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: city.place_name })).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: city.place_name }));
  expect(map.fitBounds).not.toHaveBeenCalled();
  expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: city.center }));
});

it("doesn't show location search on read-only maps", () => {
  render(<EntryMap lat={45.9} lon={6.13} />);
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});

it("places only the chosen endpoint, retains two labeled pins, and removes only invalidated pins", () => {
  const onPick = vi.fn();
  const onPickLanding = vi.fn();
  const { rerender } = render(<EntryMap lat={45.9} lon={6.13} onPick={onPick} onPickLanding={onPickLanding} />);
  const click = map.on.mock.calls.find(([name]) => name === "click")![1];
  const mapClick = () => click({ lngLat: { lat: 45.85, wrap: () => ({ lng: 6.17 }) } });
  expect(screen.getByRole("button", { name: "Flying site" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Landing" }));
  expect(screen.getByRole("button", { name: "Landing" })).toHaveAttribute("aria-pressed", "true");
  act(mapClick);
  expect(onPickLanding).toHaveBeenCalledWith(45.85, 6.17);
  expect(onPick).not.toHaveBeenCalled();
  rerender(<EntryMap lat={45.9} lon={6.13} landingLat={45.85} landingLon={6.17} onPick={onPick} onPickLanding={onPickLanding} />);
  expect(markers).toHaveLength(2);
  expect(markers[0].color).not.toBe(markers[1].color);
  expect(markers[0].element).toHaveAttribute("aria-label", "Flying site pin (blue)");
  expect(markers[1].element).toHaveAttribute("aria-label", "Landing pin (orange)");
  expect(markers[0].setLngLat).toHaveBeenLastCalledWith([6.13, 45.9]);
  expect(markers[1].setLngLat).toHaveBeenLastCalledWith([6.17, 45.85]);
  expect(map.fitBounds).toHaveBeenLastCalledWith([6.13, 45.85, 6.17, 45.9], expect.objectContaining({ maxZoom: 13 }));
  fireEvent.click(screen.getByRole("button", { name: "Flying site" }));
  act(mapClick);
  expect(onPick).toHaveBeenCalledWith(45.85, 6.17);
  expect(onPickLanding).toHaveBeenCalledTimes(1);
  rerender(<EntryMap lat={45.9} lon={6.13} landingLat={91} landingLon={6.17} onPick={onPick} onPickLanding={onPickLanding} />);
  expect(markers[1].remove).toHaveBeenCalled();
  expect(markers[0].remove).not.toHaveBeenCalled();
});
