"use client";

import { useState, type ReactNode } from "react";
import { UnitsContext } from "@/lib/flights/use-units";
import type { UnitSystem } from "@/lib/flights/format";

export function UnitsProvider({ defaultUnits, children }: { defaultUnits: UnitSystem; children: ReactNode }) {
  const [units, setUnits] = useState(defaultUnits);
  return <UnitsContext.Provider value={[units, setUnits]}>{children}</UnitsContext.Provider>;
}
