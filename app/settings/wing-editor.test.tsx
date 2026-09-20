import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WingEditor } from "./wing-editor";
import { SettingsForm } from "./settings-form";
import { saveWingNames, setWingVisibility, setWingTandem, setTandemEnabled } from "./wing-actions";
import { updateProfile } from "./actions";
vi.mock("./wing-actions", () => ({ saveWingNames: vi.fn(), setWingVisibility: vi.fn(), setWingTandem: vi.fn(), setTandemEnabled: vi.fn() }));
vi.mock("./actions", () => ({ updateProfile: vi.fn() }));
vi.mock("./avatar-uploader", () => ({ AvatarUploader: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const wings = [{ name: "Ozone Rush4", count: 2 }, { name: "Rush 4", count: 3 }, { name: "Other wing", count: 1 }];
it("requires its dedicated Save and keeps wing edits out of profile autosaving", async () => {
  vi.useFakeTimers();
  vi.mocked(saveWingNames).mockResolvedValue({ count: 5 });
  render(<SettingsForm handle="pilot" displayName="Pilot" bio="" defaultVisibility="private" defaultUnits="metric" mapDefaults={null}
    ratingsTrackingEnabled={false} avatarUpdatedAt={null} afterProfile={<WingEditor wings={wings} collapsible />} />);
  fireEvent.click(screen.getByRole("button", { name: "Expand My Wings settings" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Ozone Rush4/ }));
  expect(screen.getByRole("button", { name: "Rename wing" })).toBeDisabled();
  expect(screen.getByText("Rename:")).toHaveClass("text-brand-blue-strong");
  fireEvent.change(screen.getByLabelText("Rename wing to:"), { target: { value: "Ozone Rush 4" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Rush 4, 3 flights/ }));
  expect(screen.getByText(/all 5 matching log entries/)).toBeInTheDocument();
  expect(screen.getAllByText("Merge:")).toHaveLength(2);
  expect(screen.getByRole("checkbox", { name: /Ozone Rush4/ })).toHaveClass("accent-emergency-orange");
  fireEvent.keyDown(screen.getByLabelText("Merged wing name:"), { key: "Enter" });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(updateProfile).not.toHaveBeenCalled(); expect(saveWingNames).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Merge wings" })); });
  expect(saveWingNames).toHaveBeenCalledWith({ sources: wings.slice(0, 2), target: "Ozone Rush 4" });
  expect(screen.getByText("Saved “Ozone Rush 4” for 5 flights.")).toHaveAttribute("role", "status");
  expect(updateProfile).not.toHaveBeenCalled();
});
it("previews a merge into an existing name and allows cancellation without saving", () => {
  render(<WingEditor wings={wings} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Rush 4, 3 flights/ }));
  fireEvent.change(screen.getByLabelText("Rename wing to:"), { target: { value: "Ozone Rush4" } });
  expect(screen.getByText(/together with 2 existing flights/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Rename wing" })).not.toBeInTheDocument();
  expect(saveWingNames).not.toHaveBeenCalled();
});

it("shows wing hours and hides a wing without renaming or selecting it", async () => {
  vi.mocked(setWingVisibility).mockResolvedValue({});
  render(<WingEditor wings={[{ name: "Retired wing", count: 2, durationS: 9000, hidden: false }]} />);
  expect(screen.getByText(/2.5 h/)).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide Retired wing in flight selections" })));
  expect(setWingVisibility).toHaveBeenCalledWith("Retired wing", true);
  expect(saveWingNames).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("enables tandem independently of profile autosave and leaves wing selections untouched", async () => {
  vi.useFakeTimers();
  vi.mocked(setTandemEnabled).mockResolvedValue({});
  render(<SettingsForm handle="pilot" displayName="Pilot" bio="" defaultVisibility="private" defaultUnits="metric" mapDefaults={null}
    ratingsTrackingEnabled={false} avatarUpdatedAt={null} afterProfile={<WingEditor wings={wings} collapsible />} />);
  fireEvent.click(screen.getByRole("button", { name: "Expand My Wings settings" }));
  expect(screen.queryByRole("switch", { name: /Tandem wing:/ })).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Enable tandem" })));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(setTandemEnabled).toHaveBeenCalledWith(true);
  expect(updateProfile).not.toHaveBeenCalled();
  expect(saveWingNames).not.toHaveBeenCalled();
});

it("toggles a wing's tandem default without selecting or renaming it", async () => {
  vi.mocked(setWingTandem).mockResolvedValue({});
  render(<WingEditor wings={wings} tandemEnabled />);
  await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Tandem wing: Rush 4" })));
  expect(setWingTandem).toHaveBeenCalledWith("Rush 4", true);
  expect(screen.getByRole("checkbox", { name: /Rush 4, 3 flights/ })).not.toBeChecked();
  expect(saveWingNames).not.toHaveBeenCalled();
});

it("proposes OR for merges, accepts an explicit solo choice and resets the proposal with the selection", async () => {
  vi.mocked(saveWingNames).mockResolvedValue({ count: 3 });
  const tandemWings = wings.map((wing, index) => ({ ...wing, tandem: index === 0 }));
  render(<WingEditor wings={tandemWings} tandemEnabled />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Ozone Rush4/ }));
  expect(screen.queryByRole("switch", { name: "Merged wing is tandem" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: /Rush 4, 3 flights/ }));
  const toggle = screen.getByRole("switch", { name: "Merged wing is tandem" });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /Other wing/ }));
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Merge wings" })));
  expect(saveWingNames).toHaveBeenCalledWith({ sources: tandemWings, target: "Ozone Rush4", tandem: false });
});

it("includes an existing destination's tandem default even with just one source selected", () => {
  render(<WingEditor wings={wings.map((wing, index) => ({ ...wing, tandem: index === 0 }))} tandemEnabled />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Rush 4, 3 flights/ }));
  fireEvent.change(screen.getByLabelText("Rename wing to:"), { target: { value: "Ozone Rush4" } });
  expect(screen.getByRole("switch", { name: "Merged wing is tandem" })).toBeChecked();
});

it("reports tandem save failures and allows retrying", async () => {
  vi.mocked(setWingTandem).mockRejectedValue(new Error("offline"));
  render(<WingEditor wings={wings} tandemEnabled />);
  await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Tandem wing: Rush 4" })));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save tandem settings");
  expect(screen.getByRole("switch", { name: "Tandem wing: Rush 4" })).toBeEnabled();
});
