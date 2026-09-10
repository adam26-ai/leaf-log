"use client";

import { useState, type ReactNode } from "react";
import { UnitsContext } from "@/lib/flights/use-units";
import { readUnitMode, resolveUnits, type UnitMode, type UnitPreferences } from "@/lib/flights/units";

export function UnitsProvider({ defaultUnits, customUnits = null, children }: {
  defaultUnits: UnitMode;
  customUnits?: UnitPreferences | null;
  children: ReactNode;
}) {
  const [mode, setMode] = useState(defaultUnits);
  // Compare values so revalidation does not discard a temporary replay choice.
  const settingsKey = JSON.stringify([defaultUnits, customUnits]);
  const [previousSettings, setPreviousSettings] = useState(settingsKey);
  if (previousSettings !== settingsKey) {
    setPreviousSettings(settingsKey);
    setMode(defaultUnits);
  }
  const activeMode = readUnitMode(mode, customUnits);
  const units = activeMode === "custom" ? customUnits! : resolveUnits(activeMode);
  return <UnitsContext.Provider value={{ units, mode: activeMode, hasCustom: customUnits !== null, setMode }}>{children}</UnitsContext.Provider>;
}
