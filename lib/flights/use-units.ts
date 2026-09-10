"use client";

import { createContext, useContext } from "react";
import { METRIC_UNITS, type UnitMode, type UnitPreferences } from "./units";

export const UnitsContext = createContext<{
  units: UnitPreferences;
  mode: UnitMode;
  hasCustom: boolean;
  setMode: (next: UnitMode) => void;
}>({ units: METRIC_UNITS, mode: "metric", hasCustom: false, setMode: () => {} });

/** Account default initializes the shared temporary viewing preference. */
export function useUnits() {
  return useContext(UnitsContext);
}
