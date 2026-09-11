"use client";
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_MAP, type MapDefaults } from "@/lib/flights/map-defaults";
const Context = createContext<MapDefaults>(DEFAULT_MAP);
export const useMapDefaults = () => useContext(Context);
export function MapDefaultsProvider({ value, children }: { value: MapDefaults; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
