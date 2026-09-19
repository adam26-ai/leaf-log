import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emptyEntry, type EntryDraft } from "@/lib/logbook/entry";
import type { EntrySite } from "@/lib/logbook/options";
import { SiteField } from "./site-field";

vi.mock("@/components/flight/boundary-editor", () => ({ BoundaryEditor: () => null }));
vi.mock("@/components/logbook/entry-map-search", () => ({ EntryMapSearch: () => null }));
afterEach(cleanup);

const sites: EntrySite[] = [
  { id: "middle", name: "Upper Pine", lat: null, lon: null, previous: true, visibility: "private" },
  { id: "pine", name: "Pine Mountain", lat: 45, lon: 6, previous: false, visibility: "public", canEditVisibility: false },
  { id: "ridge", name: "Pine Ridge", lat: null, lon: null, previous: true, visibility: "private" },
];
function setup(initial: Partial<EntryDraft> = {}, endpoint: "takeoff" | "landing" = "takeoff") {
  const changed = vi.fn();
  const submitted = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState({ ...emptyEntry(), ...initial });
    return <form onSubmit={event => { event.preventDefault(); submitted(draft); }}>
      <SiteField endpoint={endpoint} label={endpoint === "takeoff" ? "Flying site" : "Landing site"} sites={sites} value={draft}
        onChange={patch => { changed(patch); setDraft(current => ({ ...current, ...patch })); }} />
    </form>;
  }
  render(<Harness />);
  return { changed, submitted };
}

it("shows prefix matches before substring matches without attaching typed text", () => {
  const { changed, submitted } = setup();
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: " pInE " } });
  const options = screen.getAllByRole("option");
  expect(options.map(option => option.textContent)).toEqual([
    "Pine RidgePrivate · Name only", "Pine MountainPublic", "Upper PinePrivate · Name only", "Add “pInE” as a new site",
  ]);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submitted).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ takeoffSiteId: "ridge", takeoffSiteName: "Pine Ridge" }));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
});

it("adds a new name explicitly and clears only the site, preserving flight coordinates", () => {
  const { changed } = setup({ takeoffLat: "45.123", takeoffLon: "6.123" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "New Meadow" } });
  expect(screen.getByText("No matching sites")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Add “New Meadow” as a new site" }));
  expect(screen.getByText("Will be created when you save this flight.")).toBeInTheDocument();
  expect(screen.getByText(/New site · Private/)).toBeInTheDocument();
  expect(changed).toHaveBeenLastCalledWith({ takeoffSiteCleared: "", takeoffSiteId: "", takeoffSiteName: "New Meadow", takeoffSiteDraft: "" });
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(changed).toHaveBeenLastCalledWith({ takeoffSiteCleared: "true", takeoffSiteId: "", takeoffSiteName: "", takeoffSiteDraft: "" });
  expect(screen.getByRole("combobox")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
});

it("cancels replacement without losing the selected site or its pending edit", () => {
  const draft = JSON.stringify({ id: "pine", name: "Renamed Pine", kind: "takeoff", visibility: "public", lat: 45, lon: 6, boundary: null });
  const { changed } = setup({ takeoffSiteId: "pine", takeoffSiteName: "Renamed Pine", takeoffSiteDraft: draft });
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Different hill" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(screen.getByText("Renamed Pine")).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep current site" }));
  expect(screen.getByText("Renamed Pine")).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

it("lets imported names open the full editor and stages changes only on Done", async () => {
  const { changed } = setup({ takeoffSiteName: "Imported Hill", takeoffLat: "45", takeoffLon: "6" });
  fireEvent.click(screen.getByRole("button", { name: "Add location or details" }));
  let editor = within(screen.getByRole("region", { name: "Site editor" }));
  fireEvent.change(editor.getByLabelText("Name"), { target: { value: "Discarded name" } });
  fireEvent.click(editor.getByRole("button", { name: "Cancel" }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByText("Imported Hill")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add location or details" }));
  editor = within(screen.getByRole("region", { name: "Site editor" }));
  fireEvent.change(editor.getByLabelText("Name"), { target: { value: "Mapped Hill" } });
  fireEvent.click(editor.getByRole("button", { name: "Done" }));
  expect(await screen.findByText("Mapped Hill")).toBeInTheDocument();
  const patch = changed.mock.lastCall![0];
  expect(JSON.parse(patch.takeoffSiteDraft)).toMatchObject({ name: "Mapped Hill", lat: 45, lon: 6, visibility: "private" });
  expect(patch).not.toHaveProperty("takeoffLat");
});

it("retains public-site visibility permissions through Site details", () => {
  const { changed } = setup({ takeoffSiteId: "pine", takeoffSiteName: "Pine Mountain" });
  fireEvent.click(screen.getByRole("button", { name: "Site details" }));
  const editor = within(screen.getByRole("region", { name: "Site editor" }));
  fireEvent.click(editor.getByRole("button", { name: "Private" }));
  expect(editor.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");
  expect(editor.getByRole("status")).toHaveTextContent("Only the site owner can change visibility.");
  expect(changed).not.toHaveBeenCalled();
});

it("supports landing selection and Escape without affecting takeoff", () => {
  const { changed } = setup({ takeoffSiteId: "pine", takeoffSiteName: "Pine Mountain" }, "landing");
  const input = screen.getByRole("combobox", { name: "Search landing site" });
  fireEvent.change(input, { target: { value: "Landing Meadow" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveAttribute("aria-expanded", "false");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(changed).toHaveBeenLastCalledWith({ landingSiteCleared: "", landingSiteId: "", landingSiteName: "Landing Meadow", landingSiteDraft: "" });
});
