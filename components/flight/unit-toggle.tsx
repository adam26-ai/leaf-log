"use client";
import { Ruler } from "lucide-react";
import { useUnits } from "@/lib/flights/use-units";

export function UnitToggle() {
  const [units, changeUnits] = useUnits();
  const metric = units === "metric";
  const label = `${metric ? "Metric" : "Imperial"} units (click for ${metric ? "Imperial" : "Metric"})`;
  return <button type="button" aria-label={label} title={label} onClick={() => changeUnits(metric ? "imperial" : "metric")}
    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-ink">
    <Ruler className="h-4 w-4" aria-hidden="true" />
  </button>;
}
