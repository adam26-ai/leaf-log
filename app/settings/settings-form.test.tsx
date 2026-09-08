import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsForm } from "./settings-form";
import { updateProfile } from "./actions";
vi.mock("./actions", () => ({ updateProfile: vi.fn() }));
vi.mock("./avatar-uploader", () => ({ AvatarUploader: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
function setup() {
  vi.useFakeTimers();
  render(<SettingsForm handle="pilot" displayName="Pilot" bio="" defaultVisibility="private" defaultUnits="metric" mapDefaults={null} avatarUpdatedAt={null} />);
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
  expect(screen.getAllByText("Saved")).toHaveLength(2);
});
it("saves icon changes and exposes failures instead of claiming success", async () => {
  vi.mocked(updateProfile).mockResolvedValue({ error: "Could not save" });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Metric.*click to change/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(vi.mocked(updateProfile).mock.calls[0][1].get("default_units")).toBe("imperial");
  expect(screen.getAllByText("Could not save")).toHaveLength(2);
});
