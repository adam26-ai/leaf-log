export const GROUP_REPLAY_COLORS = {
  groupPrimary: "#d8ff00",
  groupCompanion: "#0099ff",
  groupCardBg: "#ffffff",
  groupCardText: "#141414",
  groupCardMuted: "#4b5563",
  groupCardHover: "#e5e7eb",
  groupAvatarBg: "#ffffff",
  groupAvatarText: "#536779",
  groupSelection: "#141414",
  groupTrack: "#ffffff",
  groupTrackOutline: "#080808",
  groupBadgeIdle: "#ffffff",
  groupBadgeText: "#141414",
  groupBadgeBorder: "#141414",
};
export type GroupReplayColors = typeof GROUP_REPLAY_COLORS;
export const GROUP_COLOR_CSS = Object.fromEntries(
  Object.keys(GROUP_REPLAY_COLORS).map((key) => [key, `--replay-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`]),
) as Record<keyof GroupReplayColors, string>;
export const REPLAY_PALETTE_EVENT = "replay-palette-change";

/** Canvas/SVG overlays use the same palette as the DOM controls. */
export function readGroupReplayColors(): GroupReplayColors {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(GROUP_REPLAY_COLORS).map(([key, fallback]) => {
    const value = style.getPropertyValue(GROUP_COLOR_CSS[key as keyof GroupReplayColors]).trim();
    return [key, /^#[0-9a-f]{6}$/i.test(value) ? value : fallback];
  })) as GroupReplayColors;
}
export function colorRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}
