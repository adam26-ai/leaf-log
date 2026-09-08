export const GROUP_REPLAY_COLORS = {
  groupPrimary: "#d8ff00",
  groupCompanion: "#0099ff",
  groupCardBg: "#ffffff",
  groupCardText: "#141414",
  groupCardMuted: "#4b5563",
  groupCardHover: "#e5e7eb",
  groupAvatarBg: "#ffffff",
  groupAvatarText: "#536779",
  groupTrack: "#ffffff",
  groupTrackOutline: "#000000",
  groupBadgeIdle: "#ffffff",
  groupBadgeText: "#141414",
  groupBadgeBorder: "#141414",
};
export type GroupReplayColors = typeof GROUP_REPLAY_COLORS;
export const GROUP_REPLAY_ALPHAS = { groupTrackAlpha: 0.3, groupTrackOutlineAlpha: 1 };
export const GROUP_ALPHA_CSS = {
  groupTrackAlpha: "--replay-group-track-alpha",
  groupTrackOutlineAlpha: "--replay-group-track-outline-alpha",
};
export const GROUP_COLOR_CSS = Object.fromEntries(
  Object.keys(GROUP_REPLAY_COLORS).map((key) => [key, `--replay-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`]),
) as Record<keyof GroupReplayColors, string>;
export const REPLAY_PALETTE_EVENT = "replay-palette-change";

/** Canvas/SVG overlays use the same palette as the DOM controls. */
export function readGroupReplayColors(): GroupReplayColors & typeof GROUP_REPLAY_ALPHAS {
  const style = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(Object.entries(GROUP_REPLAY_COLORS).map(([key, fallback]) => {
    const value = style.getPropertyValue(GROUP_COLOR_CSS[key as keyof GroupReplayColors]).trim();
    return [key, /^#[0-9a-f]{6}$/i.test(value) ? value : fallback];
  })) as GroupReplayColors;
  const alphas = Object.fromEntries(Object.entries(GROUP_REPLAY_ALPHAS).map(([key, fallback]) => {
    const raw = style.getPropertyValue(GROUP_ALPHA_CSS[key as keyof typeof GROUP_ALPHA_CSS]).trim();
    const value = raw === "" ? fallback : Number(raw);
    return [key, Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback];
  })) as typeof GROUP_REPLAY_ALPHAS;
  return { ...colors, ...alphas };
}
export function colorRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}
