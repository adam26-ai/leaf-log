"use client";

import { createContext, useContext } from "react";
import type { UnitSystem } from "./format";

export const UnitsContext = createContext<[UnitSystem, (next: UnitSystem) => void]>(["metric", () => {}]);

/** Account default initializes the shared temporary viewing preference. */
export function useUnits(): [UnitSystem, (next: UnitSystem) => void] {
  return useContext(UnitsContext);
}
