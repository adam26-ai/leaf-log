"use client";

import { useEffect, useState } from "react";
import type { UnitSystem } from "./format";

const STORAGE_KEY = "leaf-units";
const CHANGE_EVENT = "leaf-units-change";

function readStored(): UnitSystem {
  if (typeof window === "undefined") return "metric";
  return localStorage.getItem(STORAGE_KEY) === "imperial" ? "imperial" : "metric";
}

/**
 * Shared Metric/Imperial preference, persisted to localStorage and kept live
 * across every mounted instance on the page (the key-statistics card and the
 * 3D replay's instrument readout are separate client components) via a
 * same-tab custom event — the `storage` event only fires in OTHER tabs.
 */
export function useUnits(): [UnitSystem, (next: UnitSystem) => void] {
  const [units, setUnits] = useState<UnitSystem>(readStored);

  useEffect(() => {
    function onChange() {
      setUnits(readStored());
    }
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  function changeUnits(next: UnitSystem) {
    setUnits(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [units, changeUnits];
}
