import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitsProvider } from "./units-provider";
import { useUnits } from "@/lib/flights/use-units";
import { UnitToggle } from "./flight/unit-toggle";
import { METRIC_UNITS } from "@/lib/flights/units";
import { formatAltitude, formatSpeed } from "@/lib/flights/format";

function Readout() {
  const { mode, setMode } = useUnits();
  return <button onClick={() => setMode("metric")}>{mode}</button>;
}

function Measurements() {
  const { units } = useUnits();
  return <p>{formatAltitude(1000, units)} / {formatSpeed(100, units)}</p>;
}

describe("account units", () => {
  it("uses the account default and synchronizes temporary changes between views", () => {
    const { rerender } = render(<UnitsProvider key="imperial" defaultUnits="imperial"><Readout /><Readout /></UnitsProvider>);
    expect(screen.getAllByRole("button", { name: "imperial" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getAllByRole("button", { name: "metric" })).toHaveLength(2);
    rerender(<UnitsProvider key="new-account" defaultUnits="imperial"><Readout /><Readout /></UnitsProvider>);
    expect(screen.getAllByRole("button", { name: "imperial" })).toHaveLength(2);
  });

  it("cycles only the two presets until custom choices have been saved", () => {
    render(<UnitsProvider defaultUnits="metric"><UnitToggle /></UnitsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Metric units (click for Imperial)" }));
    fireEvent.click(screen.getByRole("button", { name: "Imperial units (click for Metric)" }));
    expect(screen.getByRole("button", { name: "Metric units (click for Imperial)" })).toHaveTextContent("m");
  });

  it("cycles through saved mixed choices and preserves a temporary mode across unchanged revalidation", () => {
    const custom = { ...METRIC_UNITS, speed: "mph" as const };
    const { rerender } = render(<UnitsProvider defaultUnits="custom" customUnits={custom}><UnitToggle /><Measurements /></UnitsProvider>);
    expect(screen.getByText("1,000 m / 62 mph")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Custom units (click for Metric)" }));
    expect(screen.getByText("1,000 m / 100 km/h")).toBeInTheDocument();
    rerender(<UnitsProvider defaultUnits="custom" customUnits={{ ...custom }}><UnitToggle /><Measurements /></UnitsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Metric units (click for Imperial)" }));
    expect(screen.getByText("3,281 ft / 62 mph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imperial units (click for Custom)" })).toHaveTextContent("ft");
    fireEvent.click(screen.getByRole("button", { name: "Imperial units (click for Custom)" }));
    expect(screen.getByText("1,000 m / 62 mph")).toBeInTheDocument();
    rerender(<UnitsProvider defaultUnits="metric" customUnits={{ ...custom }}><UnitToggle /><Measurements /></UnitsProvider>);
    expect(screen.getByRole("button", { name: "Metric units (click for Imperial)" })).toBeInTheDocument();
  });
});
