export const PLAYBACK_SPEEDS = [1, 4, 8, 16, 32, 64, 128];
export const CAMERA_MODES = ["fixed", "follow", "chase", "orbit"] as const;
export const MAP_STYLES = ["monochrome", "satellite", "hybrid", "topo", "streets"] as const;
export interface MapDefaults {
  camera: typeof CAMERA_MODES[number];
  basemap: typeof MAP_STYLES[number];
  altitude: "asl" | "agl";
  track: "full" | "elapsed";
  speed: number;
}
export const DEFAULT_MAP: MapDefaults = { camera: "follow", basemap: "monochrome", altitude: "asl", track: "elapsed", speed: 8 };
export function readMapDefaults(value: unknown): MapDefaults {
  const v = (value && typeof value === "object" ? value : {}) as Partial<MapDefaults>;
  return {
    camera: CAMERA_MODES.includes(v.camera!) ? v.camera! : DEFAULT_MAP.camera,
    basemap: MAP_STYLES.includes(v.basemap!) ? v.basemap! : DEFAULT_MAP.basemap,
    altitude: v.altitude === "agl" ? "agl" : "asl",
    track: v.track === "full" ? "full" : "elapsed",
    speed: PLAYBACK_SPEEDS.includes(v.speed!) ? v.speed! : DEFAULT_MAP.speed,
  };
}
