import snapshot from "./profile-palette-defaults.json";

export const PROFILE_STATES = [
  { id: "ownSelected", label: "Our own — selected" },
  { id: "ownUnselected", label: "Our own — not selected" },
  { id: "friendSelected", label: "Friends — selected" },
  { id: "friendUnselected", label: "Friends — not selected" },
] as const;
export type ProfileState = typeof PROFILE_STATES[number]["id"];

export const PROFILE_FIELDS = ["profileLine", "profileFill", "terrainLine", "terrainFill", "terrainGradient"] as const;
type ProfileField = typeof PROFILE_FIELDS[number];
const SIZE_FIELDS = ["profileLine", "profileFillAlpha", "terrainLine", "terrainFillAlpha", "terrainGradientAlpha"] as const;
type ProfileSize = typeof SIZE_FIELDS[number];
export type ProfileColorKey = `${ProfileState}${Capitalize<ProfileField>}`;
export type ProfileSizeKey = `${ProfileState}${Capitalize<ProfileSize>}`;

export function profileKey<T extends string>(state: ProfileState, field: T): `${ProfileState}${Capitalize<T>}` {
  return `${state}${field[0].toUpperCase()}${field.slice(1)}` as `${ProfileState}${Capitalize<T>}`;
}
const kebab = (value: string) => value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
// Accepted palette captured from the live replay, including opacity and line widths.
export const PROFILE_COLORS = snapshot.colors satisfies Record<ProfileColorKey, string>;
export const PROFILE_SIZES = snapshot.sizes satisfies Record<ProfileSizeKey, number>;
export const PROFILE_SHARED_COLORS = snapshot.shared;
export const PROFILE_COLOR_CSS = Object.fromEntries(Object.keys(PROFILE_COLORS).map((key) => [key, `--replay-${kebab(key)}`])) as Record<ProfileColorKey, string>;
export const PROFILE_SIZE_CSS = Object.fromEntries(PROFILE_STATES.flatMap(({ id }) => SIZE_FIELDS.map((field) =>
  [profileKey(id, field), `--replay-${kebab(profileKey(id, field))}${field.endsWith("Line") ? "-width" : ""}`],
))) as Record<ProfileSizeKey, string>;

export function profileColor(state: ProfileState, field: ProfileField) {
  const key = profileKey(state, field);
  return `var(${PROFILE_COLOR_CSS[key]}, ${PROFILE_COLORS[key]})`;
}
export function profileSize(state: ProfileState, field: ProfileSize) {
  const key = profileKey(state, field);
  return `var(${PROFILE_SIZE_CSS[key]}, ${PROFILE_SIZES[key]}${field.endsWith("Alpha") ? "" : "px"})`;
}

/** Old palettes keep their selected profile appearance when adopting the four states. */
export function restoreProfileColors(colors: Partial<Record<ProfileColorKey | ProfileField, string>>) {
  return { ...PROFILE_COLORS, ...Object.fromEntries(PROFILE_FIELDS.flatMap((field) => colors[field] ? [[profileKey("ownSelected", field), colors[field]]] : [])), ...colors };
}
export function restoreProfileSizes(sizes: Partial<Record<ProfileSizeKey | ProfileSize, number>>) {
  return { ...PROFILE_SIZES, ...Object.fromEntries(SIZE_FIELDS.flatMap((field) => sizes[field] != null ? [[profileKey("ownSelected", field), sizes[field]]] : [])), ...sizes };
}
