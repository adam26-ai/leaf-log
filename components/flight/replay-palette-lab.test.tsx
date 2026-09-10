import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReplayPaletteLab } from "./replay-palette-lab";
import { readGroupReplayColors, REPLAY_PALETTE_EVENT } from "./group-replay-colors";
import { PROFILE_STATES, PROFILE_COLOR_CSS, PROFILE_SIZE_CSS, profileKey } from "./profile-palette";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ savedPresets: [], hiddenBuiltInIds: [] }) })));
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); document.documentElement.removeAttribute("style"); });

it("restores older palettes with defaults for newly added pilot colors", async () => {
  localStorage.setItem("leaf-dev-replay-palette", JSON.stringify({ presetId: "custom", colors: { timeline: "#123456" }, sizes: { timeline: 6 } }));
  render(<ReplayPaletteLab basemap="monochrome" onBasemap={vi.fn()} />);
  await waitFor(() => expect(document.documentElement.style.getPropertyValue("--replay-timeline")).toBe("#123456"));
  expect(readGroupReplayColors().groupBadgeIdle).toBe("#ffffff");
  expect(readGroupReplayColors().groupTrackAlpha).toBe(0.3);
  expect(readGroupReplayColors().groupTrackOutlineAlpha).toBe(1);
  expect(document.documentElement.style.getPropertyValue("--replay-group-card-alpha")).toBe("0.55");
});

it("publishes live map colors and saves card opacity without making avatars transparent", async () => {
  const listener = vi.fn();
  window.addEventListener(REPLAY_PALETTE_EVENT, listener);
  try {
    render(<ReplayPaletteLab basemap="monochrome" onBasemap={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Palette lab" }));
    fireEvent.click(screen.getByText("Friends & pilots"));
    fireEvent.change(screen.getByLabelText("Unselected track color"), { target: { value: "#ff9900" } });
    expect(readGroupReplayColors().groupTrack).toBe("#ff9900");
    expect(listener).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Pilot card background opacity"), { target: { value: "0.4" } });
    expect(document.documentElement.style.getPropertyValue("--replay-group-card-alpha")).toBe("0.4");
    expect(readGroupReplayColors().groupAvatarBg).toBe("#ffffff");
    const saved = JSON.parse(localStorage.getItem("leaf-dev-replay-palette")!);
    expect(saved.colors.groupTrack).toBe("#ff9900");
    expect(saved.sizes.groupCardAlpha).toBe(0.4);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  } finally { window.removeEventListener(REPLAY_PALETTE_EVENT, listener); }
});

it("publishes independent track alpha changes after CSS updates and persists them", async () => {
  const listener = vi.fn(() => readGroupReplayColors());
  window.addEventListener(REPLAY_PALETTE_EVENT, listener);
  try {
    render(<ReplayPaletteLab basemap="monochrome" onBasemap={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Palette lab" }));
    fireEvent.click(screen.getByText("Friends & pilots"));
    fireEvent.change(screen.getByLabelText("Unselected track alpha"), { target: { value: "0" } });
    expect(listener.mock.results.at(-1)?.value).toMatchObject({ groupTrackAlpha: 0, groupTrackOutlineAlpha: 1 });
    fireEvent.change(screen.getByLabelText("Unselected track outline alpha"), { target: { value: "0.35" } });
    expect(listener.mock.results.at(-1)?.value).toMatchObject({ groupTrackAlpha: 0, groupTrackOutlineAlpha: 0.35 });
    expect(JSON.parse(localStorage.getItem("leaf-dev-replay-palette")!).sizes).toMatchObject({ groupTrackAlpha: 0, groupTrackOutlineAlpha: 0.35 });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  } finally { window.removeEventListener(REPLAY_PALETTE_EVENT, listener); }
});

it("keeps four profile palettes independent, including transparent fills and legacy selected colors", async () => {
  localStorage.setItem("leaf-dev-replay-palette", JSON.stringify({ colors: { profileLine: "#123456" }, sizes: { terrainLine: 4 } }));
  render(<ReplayPaletteLab basemap="monochrome" onBasemap={vi.fn()} />);
  await waitFor(() => expect(document.documentElement.style.getPropertyValue(PROFILE_COLOR_CSS.ownSelectedProfileLine)).toBe("#123456"));
  expect(document.documentElement.style.getPropertyValue(PROFILE_SIZE_CSS.ownSelectedTerrainLine)).toBe("4px");
  fireEvent.click(screen.getByRole("button", { name: "Palette lab" }));
  await waitFor(() => expect(screen.getByLabelText("Our own — selected: profile line color")).toHaveValue("#123456"));
  for (const { id, label } of PROFILE_STATES) {
    fireEvent.click(screen.getByText(`Profile · ${label}`));
    fireEvent.change(screen.getByLabelText(`${label}: profile fill alpha`), { target: { value: "0" } });
    expect(document.documentElement.style.getPropertyValue(PROFILE_SIZE_CSS[profileKey(id, "profileFillAlpha")])).toBe("0");
    fireEvent.change(screen.getByLabelText(`${label}: profile fill color`), { target: { value: "#ff00ff" } });
    expect(document.documentElement.style.getPropertyValue(PROFILE_COLOR_CSS[profileKey(id, "profileFill")])).toBe("#ff00ff");
  }
  expect(document.documentElement.style.getPropertyValue(PROFILE_COLOR_CSS.ownSelectedProfileLine)).toBe("#123456");
  expect(document.documentElement.style.getPropertyValue(PROFILE_COLOR_CSS.friendSelectedProfileLine)).toBe("#0099ff");
  const saved = JSON.parse(localStorage.getItem("leaf-dev-replay-palette")!);
  expect(saved.sizes.friendUnselectedProfileFillAlpha).toBe(0);
});
