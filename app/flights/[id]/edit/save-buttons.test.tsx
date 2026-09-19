import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FlightWingEditor } from "./wing-editor";
import { FlightDetailsEditor } from "./flight-details-editor";
import { InstructorEditor } from "./instructor-editor";

vi.mock("./actions", () => ({
  updateFlightWing: vi.fn(),
  updateFlightDetails: vi.fn(),
  updateInstructor: vi.fn(),
}));

afterEach(cleanup);

it("puts the editable wing name before previous wings and activates save only for a changed wing", () => {
  render(<FlightWingEditor flightId="flight" glider="Alpha" gliders={["Beta"]} />);
  const save = screen.getByRole("button", { name: "Save wing" });
  const name = screen.getByRole("textbox", { name: "Wing name" });
  const previous = screen.getByRole("combobox", { name: "Choose a previous wing" });
  expect(name.compareDocumentPosition(previous) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(save).toBeDisabled();
  fireEvent.change(previous, { target: { value: "Beta" } });
  expect(name).toHaveValue("Beta");
  expect(save).toBeEnabled();
  fireEvent.change(name, { target: { value: "Alpha" } });
  expect(save).toBeDisabled();
});

it("activates flight details save only while values differ", () => {
  render(<FlightDetailsEditor flightId="flight" details={{ occupancy: "solo", flightTypeTags: [], launchTypes: [], restrictedLandingField: false }} />);
  const save = screen.getByRole("button", { name: "Save flight details" });
  const landing = screen.getByRole("checkbox", { name: /Restricted Landing Field/ });
  expect(save).toBeDisabled();
  fireEvent.click(landing);
  expect(save).toBeEnabled();
  fireEvent.click(landing);
  expect(save).toBeDisabled();
});

it("activates instructor save only when the assignment changes", () => {
  render(<InstructorEditor flightId="flight" instructorId={null} options={[{ id: "pilot", displayName: "Alex", handle: "alex" }]} />);
  const save = screen.getByRole("button", { name: "Save instructor" });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Alex/ }));
  expect(save).toBeEnabled();
  fireEvent.click(screen.getByRole("radio", { name: "None" }));
  expect(save).toBeDisabled();
});
