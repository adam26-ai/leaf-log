import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiteEditor } from "./site-editor";
vi.mock("./boundary-editor", () => ({ BoundaryEditor: () => null }));
vi.mock("@/components/logbook/entry-map-search", () => ({ EntryMapSearch: () => null }));
afterEach(cleanup);
const initial = { name: "Ridge", kind: "both" as const, visibility: "private" as const, lat: 45, lon: 6, boundary: null };
it("highlights the editing tool and selected visibility", () => {
  render(<SiteEditor initial={initial} onSave={vi.fn()} onCancel={vi.fn()} />);
  const pin = screen.getByRole("button", { name: "Place or move pin" });
  const boundary = screen.getByRole("button", { name: "Draw or edit boundary" });
  expect(pin).toHaveAttribute("aria-pressed", "true");
  expect(pin).toHaveClass("bg-brand-blue");
  fireEvent.click(boundary);
  expect(boundary).toHaveAttribute("aria-pressed", "true");
  expect(boundary).toHaveClass("bg-brand-blue");
  expect(pin).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Public" }));
  expect(screen.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");
});
it("explains a visibility restriction only when the pilot tries changing it", () => {
  render(<SiteEditor initial={{ ...initial, visibility: "public" }} canChangeVisibility={false} onSave={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByText("Only the site owner can change visibility.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Private" }));
  expect(screen.getByRole("status")).toHaveTextContent("Only the site owner can change visibility.");
  expect(screen.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");
});
it("keeps the draft visible and shows a returned save conflict", async () => {
  const onSave = vi.fn().mockRejectedValue(new Error("This site changed. Reload its details before saving; your draft has not been saved."));
  render(<SiteEditor initial={{ ...initial, kind: "takeoff" }} onSave={onSave} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Used for" }), { target: { value: "both" } });
  fireEvent.click(screen.getByRole("button", { name: "Save site" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This site changed"));
  expect(screen.getByRole("combobox", { name: "Used for" })).toHaveValue("both");
  expect(screen.getByRole("button", { name: "Save site" })).toBeEnabled();
});
