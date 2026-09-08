"use client";

import { useEffect, useState } from "react";
import { Palette, RotateCcw, Save, Trash2, X } from "lucide-react";
import { BASEMAPS, hasMapTiler, type BasemapId } from "./basemaps";
import { cn } from "@/lib/utils";

type PaletteKey =
  | "accent"
  | "accentStrong"
  | "activeBg"
  | "activeFg"
  | "activeBorder"
  | "inactiveBg"
  | "inactiveFg"
  | "inactiveBorder"
  | "icon"
  | "metricIconBg"
  | "timeline"
  | "timelineDotFill"
  | "profileLine"
  | "profileFill"
  | "terrainLine"
  | "terrainFill"
  | "terrainGradient"
  | "profileSky";

type ReplayPalette = Record<PaletteKey, string>;

type SizeKey =
  | "buttonBorder"
  | "buttonIcon"
  | "inactiveButtonBorder"
  | "inactiveButtonIcon"
  | "metricIcon"
  | "timeline"
  | "profileLine"
  | "terrainLine"
  | "terrainFillAlpha"
  | "terrainGradientAlpha"
  | "headerAccent";

type ReplaySizes = Record<SizeKey, number>;

interface SavedPreset {
  id: string;
  label: string;
  colors: ReplayPalette;
  sizes: ReplaySizes;
}

const STORAGE_KEY = "leaf-dev-replay-palette";

const DEFAULT_SIZES: ReplaySizes = {
  buttonBorder: 1.5,
  buttonIcon: 2,
  inactiveButtonBorder: 1,
  inactiveButtonIcon: 1.25,
  metricIcon: 3.25,
  timeline: 4,
  profileLine: 2,
  terrainLine: 2.5,
  terrainFillAlpha: 1,
  terrainGradientAlpha: 0.75,
  headerAccent: 5,
};

const PRESETS: { id: string; label: string; colors: ReplayPalette }[] = [
  {
    id: "cool-blue-3",
    label: "Site default · Cool Blue 3",
    colors: {
      accent: "#0099ff", accentStrong: "#0099ff", activeBg: "#0099ff",
      activeFg: "#ffffff", activeBorder: "#d8ff00", icon: "#d8ff00",
      inactiveBg: "#ffffff", inactiveFg: "#536779", inactiveBorder: "#bfd3df",
      metricIconBg: "#424242",
      timeline: "#0099ff", profileLine: "#0099ff", profileFill: "#aeff00",
      timelineDotFill: "#ffffff",
      terrainLine: "#536779", terrainFill: "#a5aeb6", profileSky: "#cde6fe",
      terrainGradient: "#5c5c5c",
    },
  },
  {
    id: "orange",
    label: "Legacy orange",
    colors: {
      accent: "#ffb459", accentStrong: "#f59e2c", activeBg: "#ffb459",
      activeFg: "#141414", activeBorder: "#ffb459", icon: "#f59e2c",
      inactiveBg: "#ffffff", inactiveFg: "#555555", inactiveBorder: "#cfcfcf",
      metricIconBg: "#ededed",
      timeline: "#ffb459", profileLine: "#f59e2c", profileFill: "#ffb459",
      timelineDotFill: "#ffffff",
      terrainLine: "#596b49", terrainFill: "#71835f", profileSky: "#ffffff",
      terrainGradient: "#b8c7a8",
    },
  },
  {
    id: "hero-green",
    label: "Hero green",
    colors: {
      accent: "#d8ff00", accentStrong: "#91ad00", activeBg: "#d8ff00",
      activeFg: "#141414", activeBorder: "#b8d900", icon: "#91ad00",
      inactiveBg: "#ffffff", inactiveFg: "#555555", inactiveBorder: "#cfcfcf",
      metricIconBg: "#3a3a3a",
      timeline: "#d8ff00", profileLine: "#91ad00", profileFill: "#d8ff00",
      timelineDotFill: "#ffffff",
      terrainLine: "#596b49", terrainFill: "#71835f", profileSky: "#f8faef",
      terrainGradient: "#b8c7a8",
    },
  },
  {
    id: "soft-leaf",
    label: "Soft leaf",
    colors: {
      accent: "#efffb3", accentStrong: "#667d00", activeBg: "#efffb3",
      activeFg: "#141414", activeBorder: "#bdd945", icon: "#667d00",
      inactiveBg: "#ffffff", inactiveFg: "#59633e", inactiveBorder: "#cfd6b4",
      metricIconBg: "#e8eadf",
      timeline: "#bdd945", profileLine: "#667d00", profileFill: "#d8ff00",
      timelineDotFill: "#ffffff",
      terrainLine: "#657154", terrainFill: "#879472", profileSky: "#fbfff0",
      terrainGradient: "#c3ccb7",
    },
  },
  {
    id: "electric-blue",
    label: "Electric blue",
    colors: {
      accent: "#0099ff", accentStrong: "#006fbd", activeBg: "#0099ff",
      activeFg: "#ffffff", activeBorder: "#007dcc", icon: "#007dcc",
      inactiveBg: "#ffffff", inactiveFg: "#536779", inactiveBorder: "#bfd3df",
      metricIconBg: "#e4ebef",
      timeline: "#0099ff", profileLine: "#007dcc", profileFill: "#0099ff",
      timelineDotFill: "#ffffff",
      terrainLine: "#536779", terrainFill: "#71879a", profileSky: "#f2f9ff",
      terrainGradient: "#b9c9d6",
    },
  },
  {
    id: "graphite-dual",
    label: "Graphite + leaf",
    colors: {
      accent: "#d8ff00", accentStrong: "#91ad00", activeBg: "#2b2b2b",
      activeFg: "#d8ff00", activeBorder: "#454545", icon: "#91ad00",
      inactiveBg: "#ffffff", inactiveFg: "#4f4f4f", inactiveBorder: "#c7c7c7",
      metricIconBg: "#353535",
      timeline: "#0099ff", profileLine: "#007dcc", profileFill: "#0099ff",
      timelineDotFill: "#2b2b2b",
      terrainLine: "#4d5b42", terrainFill: "#748264", profileSky: "#f4f6f2",
      terrainGradient: "#aab59e",
    },
  },
];

const COLOR_FIELDS: {
  key: PaletteKey;
  label: string;
  sizeKey?: SizeKey;
  min?: number;
  max?: number;
  step?: number;
  numericLabel?: string;
  unit?: string;
}[] = [
  { key: "accentStrong", label: "Header accent", sizeKey: "headerAccent", min: 1, max: 10, step: 0.5 },
  { key: "metricIconBg", label: "Metric icon circle" },
  { key: "icon", label: "Metric icon symbol", sizeKey: "metricIcon", min: 0.5, max: 4, step: 0.25 },
  { key: "activeBg", label: "Selected button fill" },
  { key: "activeFg", label: "Selected button symbol", sizeKey: "buttonIcon", min: 0.5, max: 4, step: 0.25 },
  { key: "activeBorder", label: "Selected button border", sizeKey: "buttonBorder", min: 0, max: 4, step: 0.25 },
  { key: "inactiveBg", label: "Unselected button fill" },
  { key: "inactiveFg", label: "Unselected button symbol", sizeKey: "inactiveButtonIcon", min: 0.5, max: 4, step: 0.25 },
  { key: "inactiveBorder", label: "Unselected button border", sizeKey: "inactiveButtonBorder", min: 0, max: 4, step: 0.25 },
  { key: "timeline", label: "Timeline", sizeKey: "timeline", min: 1, max: 12, step: 0.5 },
  { key: "timelineDotFill", label: "Timeline dot fill" },
  { key: "profileSky", label: "Profile sky" },
  { key: "profileLine", label: "Profile line", sizeKey: "profileLine", min: 0.5, max: 6, step: 0.25 },
  { key: "profileFill", label: "Profile fill" },
  { key: "terrainLine", label: "Terrain line", sizeKey: "terrainLine", min: 0, max: 6, step: 0.25 },
  { key: "terrainFill", label: "Terrain background", sizeKey: "terrainFillAlpha", min: 0, max: 1, step: 0.05, numericLabel: "alpha", unit: "α" },
  { key: "terrainGradient", label: "Terrain gradient", sizeKey: "terrainGradientAlpha", min: 0, max: 1, step: 0.05, numericLabel: "alpha", unit: "α" },
];

const CSS_NAMES: Record<PaletteKey, string> = {
  accent: "--replay-accent",
  accentStrong: "--replay-accent-strong",
  activeBg: "--replay-active-bg",
  activeFg: "--replay-active-fg",
  activeBorder: "--replay-active-border",
  inactiveBg: "--replay-inactive-bg",
  inactiveFg: "--replay-inactive-fg",
  inactiveBorder: "--replay-inactive-border",
  icon: "--replay-icon",
  metricIconBg: "--replay-metric-icon-bg",
  timeline: "--replay-timeline",
  timelineDotFill: "--replay-timeline-dot-fill",
  profileLine: "--replay-profile-line",
  profileFill: "--replay-profile-fill",
  terrainLine: "--replay-terrain-line",
  terrainFill: "--replay-terrain-fill",
  terrainGradient: "--replay-terrain-gradient",
  profileSky: "--replay-profile-sky",
};

const SIZE_CSS_NAMES: Record<SizeKey, string> = {
  buttonBorder: "--replay-button-border-width",
  buttonIcon: "--replay-button-icon-stroke",
  inactiveButtonBorder: "--replay-inactive-button-border-width",
  inactiveButtonIcon: "--replay-inactive-button-icon-stroke",
  metricIcon: "--replay-metric-icon-stroke",
  timeline: "--replay-timeline-width",
  profileLine: "--replay-profile-line-width",
  terrainLine: "--replay-terrain-line-width",
  terrainFillAlpha: "--replay-terrain-fill-alpha",
  terrainGradientAlpha: "--replay-terrain-gradient-alpha",
  headerAccent: "--replay-header-accent-height",
};

function applyPalette(colors: ReplayPalette) {
  for (const [key, value] of Object.entries(colors) as [PaletteKey, string][]) {
    document.documentElement.style.setProperty(CSS_NAMES[key], value);
  }
}

function applySizes(sizes: ReplaySizes) {
  for (const [key, value] of Object.entries(sizes) as [SizeKey, number][]) {
    document.documentElement.style.setProperty(
      SIZE_CSS_NAMES[key],
      key === "terrainFillAlpha" || key === "terrainGradientAlpha"
        ? String(value)
        : `${value}px`,
    );
  }
}

export function ReplayPaletteLab({
  basemap,
  onBasemap,
}: {
  basemap: BasemapId;
  onBasemap: (id: BasemapId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState("orange");
  const [colors, setColors] = useState<ReplayPalette>(PRESETS[0].colors);
  const [sizes, setSizes] = useState<ReplaySizes>(DEFAULT_SIZES);
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [hiddenBuiltInIds, setHiddenBuiltInIds] = useState<string[]>([]);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    let frame = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
        | {
            presetId?: string;
            colors?: Partial<ReplayPalette>;
            sizes?: Partial<ReplaySizes>;
            savedPresets?: SavedPreset[];
            hiddenBuiltInIds?: string[];
          }
        | null;
      if (saved?.colors) {
        const base = PRESETS.find((preset) => preset.id === saved.presetId)?.colors ?? PRESETS[0].colors;
        const restored = { ...base, ...saved.colors };
        const restoredSizes = { ...DEFAULT_SIZES, ...saved.sizes };
        applyPalette(restored);
        applySizes(restoredSizes);
        frame = requestAnimationFrame(() => {
          setColors(restored);
          setSizes(restoredSizes);
          setSavedPresets(saved.savedPresets ?? []);
          setHiddenBuiltInIds(saved.hiddenBuiltInIds ?? []);
          setPresetId(saved.presetId ?? "custom");
        });
      }
    } catch {
      /* A malformed dev preference should never affect the replay. */
    }
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/dev/replay-palettes", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((library: { savedPresets?: SavedPreset[]; hiddenBuiltInIds?: string[] }) => {
        if (!active) return;
        if (library.savedPresets?.length) setSavedPresets(library.savedPresets);
        if (library.hiddenBuiltInIds?.length) setHiddenBuiltInIds(library.hiddenBuiltInIds);
      })
      .catch(() => {
        /* Browser storage remains available if the dev file cannot be read. */
      });
    return () => {
      active = false;
    };
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  function save(
    next: ReplayPalette,
    nextPreset: string,
    nextSizes = sizes,
    nextSavedPresets = savedPresets,
    nextHiddenBuiltInIds = hiddenBuiltInIds,
  ) {
    setColors(next);
    setSizes(nextSizes);
    setPresetId(nextPreset);
    applyPalette(next);
    applySizes(nextSizes);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        presetId: nextPreset,
        colors: next,
        sizes: nextSizes,
        savedPresets: nextSavedPresets,
        hiddenBuiltInIds: nextHiddenBuiltInIds,
      }),
    );
  }

  function writePresetFile(nextSaved: SavedPreset[], nextHidden: string[]) {
    void fetch("/api/dev/replay-palettes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ savedPresets: nextSaved, hiddenBuiltInIds: nextHidden }),
    });
  }

  function saveNamedPreset() {
    const label = presetName.trim();
    if (!label) return;
    const existing = savedPresets.find(
      (preset) => preset.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    const saved: SavedPreset = {
      id: existing?.id ?? `saved-${Date.now()}`,
      label,
      colors: { ...PRESETS[0].colors, ...colors },
      sizes: { ...DEFAULT_SIZES, ...sizes },
    };
    const next = existing
      ? savedPresets.map((preset) => (preset.id === existing.id ? saved : preset))
      : [...savedPresets, saved];
    setSavedPresets(next);
    setPresetName("");
    save(saved.colors, saved.id, saved.sizes, next, hiddenBuiltInIds);
    writePresetFile(next, hiddenBuiltInIds);
  }

  function deleteSavedPreset(id: string) {
    const next = savedPresets.filter((preset) => preset.id !== id);
    setSavedPresets(next);
    save(colors, presetId === id ? "custom" : presetId, sizes, next, hiddenBuiltInIds);
    writePresetFile(next, hiddenBuiltInIds);
  }

  function deleteBuiltInPreset(id: string) {
    const next = [...new Set([...hiddenBuiltInIds, id])];
    setHiddenBuiltInIds(next);
    save(colors, presetId === id ? "custom" : presetId, sizes, savedPresets, next);
    writePresetFile(savedPresets, next);
  }

  function restoreBuiltInPresets() {
    setHiddenBuiltInIds([]);
    save(colors, presetId, sizes, savedPresets, []);
    writePresetFile(savedPresets, []);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[100] flex h-10 items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 font-condensed text-sm font-bold text-white shadow-pop"
        title="Open development palette lab"
      >
        <Palette className="h-4 w-4" /> Palette lab
      </button>
    );
  }

  return (
    <aside className="fixed bottom-4 right-4 z-[100] w-[340px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-gray-300 bg-paper/95 p-3 text-ink shadow-pop backdrop-blur-md">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 font-condensed text-base font-bold">
            <Palette className="h-4 w-4" /> Palette lab
          </div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Development only · updates instantly</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded hover:bg-gray-100" aria-label="Close palette lab">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-1 font-condensed text-xs font-bold uppercase tracking-wide text-gray-500">Preset</p>
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.filter((preset) => !hiddenBuiltInIds.includes(preset.id)).map((preset) => (
          <div key={preset.id} className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1">
            <button
              type="button"
              onClick={() => save(preset.colors, preset.id)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-medium",
                presetId === preset.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 hover:border-gray-400",
              )}
            >
              <span className="h-3 w-3 shrink-0 rounded-full border border-black/20" style={{ background: preset.colors.activeBg }} />
              <span className="truncate">{preset.label}</span>
            </button>
            <button
              type="button"
              onClick={() => deleteBuiltInPreset(preset.id)}
              className="grid h-8 w-7 place-items-center rounded-md border border-gray-200 text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
              aria-label={`Delete ${preset.label} preset`}
              title={`Delete ${preset.label}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {hiddenBuiltInIds.length > 0 && (
        <button
          type="button"
          onClick={restoreBuiltInPresets}
          className="mt-1.5 text-[10px] font-medium text-gray-500 hover:text-ink"
        >
          Restore deleted built-in presets
        </button>
      )}

      {savedPresets.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {savedPresets.map((preset) => (
            <div key={preset.id} className="grid grid-cols-[minmax(0,1fr)_2rem] gap-1">
              <button
                type="button"
                onClick={() =>
                  save(
                    { ...PRESETS[0].colors, ...preset.colors },
                    preset.id,
                    { ...DEFAULT_SIZES, ...preset.sizes },
                  )
                }
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-medium",
                  presetId === preset.id
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 hover:border-gray-400",
                )}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-black/20"
                  style={{ background: preset.colors.activeBg }}
                />
                <span className="truncate">{preset.label}</span>
              </button>
              <button
                type="button"
                onClick={() => deleteSavedPreset(preset.id)}
                className="grid h-8 w-8 place-items-center rounded-md border border-gray-200 text-gray-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                aria-label={`Delete ${preset.label} preset`}
                title={`Delete ${preset.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        <input
          type="text"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") saveNamedPreset();
          }}
          placeholder="Preset name"
          aria-label="New preset name"
          className="h-8 min-w-0 flex-1 rounded-md border border-gray-300 bg-paper px-2 text-xs outline-none focus:border-gray-600"
        />
        <button
          type="button"
          disabled={!presetName.trim()}
          onClick={saveNamedPreset}
          className="flex h-8 items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
      </div>

      <p className="mb-1 mt-3 font-condensed text-xs font-bold uppercase tracking-wide text-gray-500">Fine tune</p>
      <div className="flex flex-col divide-y divide-gray-100">
        {COLOR_FIELDS.map(({ key, label, sizeKey, min, max, step, numericLabel, unit }) => (
          <div key={key} className="grid min-h-9 grid-cols-[minmax(0,1fr)_2rem_5rem] items-center gap-2 py-1 text-[11px] text-gray-700">
            <span className="truncate">{label}</span>
            <input
              aria-label={`${label} color`}
              type="color"
              value={colors[key] || PRESETS[0].colors[key]}
              onChange={(event) =>
                save(
                  { ...PRESETS[0].colors, ...colors, [key]: event.target.value },
                  "custom",
                )
              }
              className="h-6 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            {sizeKey ? (
              <label className="flex items-center justify-end gap-1">
                <input
                  aria-label={`${label} ${numericLabel ?? "size"}`}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={sizes[sizeKey] ?? DEFAULT_SIZES[sizeKey]}
                  onChange={(event) => {
                    const value = Math.max(min ?? 0, Math.min(max ?? 20, Number(event.target.value)));
                    save(colors, "custom", { ...DEFAULT_SIZES, ...sizes, [sizeKey]: value });
                  }}
                  className="h-7 w-[3.5rem] rounded border border-gray-300 bg-paper px-1 text-right font-mono text-[11px] tabular-nums"
                />
                <span className="text-[9px] text-gray-400">{unit ?? "px"}</span>
              </label>
            ) : (
              <span className="text-right text-[9px] text-gray-400">—</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-gray-200 pt-3">
        <p className="mb-1 font-condensed text-xs font-bold uppercase tracking-wide text-gray-500">Live map background</p>
        <div className="flex flex-wrap gap-1.5">
          {BASEMAPS.map((map) => {
            const disabled = map.needsKey && !hasMapTiler();
            return (
              <button
                key={map.id}
                type="button"
                disabled={disabled}
                title={disabled ? `${map.label} needs a MapTiler key` : `Preview on ${map.label}`}
                onClick={() => onBasemap(map.id)}
                className={cn(
                  "rounded border px-2 py-1 text-[11px] font-medium",
                  basemap === map.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 hover:border-gray-400",
                  disabled && "cursor-not-allowed opacity-35",
                )}
              >
                {map.label}
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" onClick={() => save(PRESETS[0].colors, PRESETS[0].id, DEFAULT_SIZES)} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-ink">
        <RotateCcw className="h-3.5 w-3.5" /> Reset to Cool Blue 3
      </button>
    </aside>
  );
}
