import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Flight } from "@prisma/client";
import type { FlightFlag } from "@/lib/flights/type-flags";
import { FlightEditSections } from "./flight-edit-sections";

const { save, refresh } = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/flights/[id]/edit/actions", () => ({ saveFlightFlags: save }));
vi.mock("@/lib/flights/igc-details", () => ({ getIgcDetailsOptions: async () => ({ recording: null, gliders: [] }) }));
vi.mock("@/lib/logbook/options", () => ({ getEntryOptions: vi.fn() }));
vi.mock("@/lib/logbook/flight-draft", () => ({ flightToEntryDraft: vi.fn() }));
vi.mock("./visibility-editor", () => ({ VisibilityEditor: () => null }));
vi.mock("./delete-flight-button", () => ({ DeleteFlightButton: () => null }));
vi.mock("@/app/flights/[id]/edit/notes-editor", () => ({ NotesEditor: () => null }));
vi.mock("@/app/flights/[id]/edit/photos-section", () => ({ PhotosSection: () => null }));
vi.mock("@/app/flights/[id]/edit/wing-editor", () => ({ FlightWingEditor: () => null }));
vi.mock("./recording-details", () => ({ RecordingDetails: () => null }));
vi.mock("@/components/logbook/manual-entry-form", () => ({ ManualEntryForm: () => null }));
vi.mock("@/components/logbook/attach-igc-form", () => ({ AttachIgcForm: () => null }));
vi.mock("./rating-tracking-section", () => ({ RatingTrackingSection: () => null }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });
function sections(flags: FlightFlag[]) {
  return FlightEditSections({ flight: { id: "flight", ownerId: "pilot", recordingKind: "igc", flightFlags: flags, occupancy: "solo", launchTypes: [], visibility: "private" } as unknown as Flight, ratingsTrackingEnabled: false });
}

it("keeps save feedback when the refreshed server tree contains the newly saved types", async () => {
  save.mockResolvedValue({ ok: true });
  const view = render(await sections(["tandem", "siv"]));
  expect(screen.getByRole("group", { name: "Select all that apply" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save flight type" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Tandem" }));
  expect(screen.getByRole("button", { name: "Save flight type" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save flight type" }));
  expect(await screen.findByText("Saved.")).toBeVisible();
  expect(save).toHaveBeenCalledWith("flight", ["siv"], true);
  expect(refresh).toHaveBeenCalled();
  view.rerender(await sections(["siv"]));
  expect(screen.getByText("Saved.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save flight type" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Tandem" })).not.toBeChecked();
});

it("preserves drafts across unrelated refreshes and reconciles flags changed by another editor", async () => {
  const view = render(await sections(["siv"]));
  fireEvent.click(screen.getByRole("checkbox", { name: "Tow" }));
  expect(screen.getByRole("button", { name: "Save flight type" })).toBeEnabled();
  view.rerender(await sections(["siv"]));
  expect(screen.getByRole("checkbox", { name: "Tow" })).toBeChecked();
  view.rerender(await sections(["siv", "tandem"]));
  expect(screen.getByRole("checkbox", { name: "Tow" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Tandem" })).toBeChecked();
});
