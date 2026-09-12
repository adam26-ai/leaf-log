import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsForm } from "./settings-form";
import { updateProfile } from "./actions";
vi.mock("./actions", () => ({ updateProfile: vi.fn() }));
vi.mock("./avatar-uploader", () => ({ AvatarUploader: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
function setup() {
  vi.useFakeTimers();
  render(<SettingsForm handle="pilot" displayName="Pilot" bio="" defaultVisibility="private" defaultUnits="metric" mapDefaults={null} ratingsTrackingEnabled={false} avatarUpdatedAt={null} />);
}
it("debounces typing and queues newer edits until an in-flight save finishes", async () => {
  let finish!: (value: { ok: boolean }) => void;
  vi.mocked(updateProfile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true });
  setup();
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "First" } });
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Second" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(updateProfile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(updateProfile).mock.calls[0][1].get("display_name")).toBe("Second");
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Third" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(updateProfile).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ok: true }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(vi.mocked(updateProfile).mock.calls[1][1].get("display_name")).toBe("Third");
  expect(screen.getAllByText("Saved")).toHaveLength(3);
});
it("saves unit changes and exposes failures instead of claiming success", async () => {
  vi.mocked(updateProfile).mockResolvedValue({ error: "Could not save" });
  setup();
  fireEvent.change(screen.getByRole("combobox", { name: "Units" }), { target: { value: "imperial" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(vi.mocked(updateProfile).mock.calls[0][1].get("default_units")).toBe("imperial");
  expect(screen.getAllByText("Could not save")).toHaveLength(3);
});

it("expands and autosaves independent custom units, retaining them when choosing a preset", async () => {
  vi.mocked(updateProfile).mockResolvedValue({ ok: true });
  setup();
  const select = screen.getByRole("combobox", { name: "Units" });
  expect(screen.queryByRole("group", { name: "Altitude" })).not.toBeInTheDocument();
  fireEvent.change(select, { target: { value: "custom" } });
  expect(within(screen.getByRole("group", { name: "Altitude" })).getByRole("radio", { name: "Meters" })).toBeChecked();
  fireEvent.click(within(screen.getByRole("group", { name: "Speed" })).getByRole("radio", { name: "mph" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Distance" })).getByRole("radio", { name: "Nautical miles" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Vertical speed" })).getByRole("radio", { name: "Knots" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  const data = vi.mocked(updateProfile).mock.calls[0][1];
  expect(data.get("default_units")).toBe("custom");
  expect(JSON.parse(String(data.get("custom_units")))).toEqual({ altitude: "m", speed: "mph", distance: "nautical-miles", vario: "knots" });
  fireEvent.change(select, { target: { value: "imperial" } });
  expect(screen.queryByRole("group", { name: "Altitude" })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(vi.mocked(updateProfile).mock.calls[1][1].get("custom_units")).toBe(data.get("custom_units"));
  fireEvent.change(select, { target: { value: "custom" } });
  expect(within(screen.getByRole("group", { name: "Speed" })).getByRole("radio", { name: "mph" })).toBeChecked();
});
