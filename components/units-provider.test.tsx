import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitsProvider } from "./units-provider";
import { useUnits } from "@/lib/flights/use-units";

function Readout() {
  const [units, setUnits] = useUnits();
  return <button onClick={() => setUnits("metric")}>{units}</button>;
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
});
