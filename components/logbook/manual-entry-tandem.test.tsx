import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManualEntryForm } from "./manual-entry-form";
import { emptyEntry } from "@/lib/logbook/entry";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const options = { wings: ["Solo", "Tandem"], tandemWings: ["Tandem"], sites: [], siteNames: [] };

it("shows wing defaults immediately and keeps unrelated tags from becoming a tandem override", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "saved" }) });
  vi.stubGlobal("fetch", fetch);
  render(<ManualEntryForm options={options} initial={{ ...emptyEntry(), date: "2000-01-01" }} />);
  fireEvent.change(screen.getByLabelText("Wing"), { target: { value: "Tandem" } });
  expect(screen.getByRole("checkbox", { name: "Tandem" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Tow" }));
  fireEvent.click(screen.getByRole("button", { name: "Add manual flight" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body).toMatchObject({ tandemTouched: false, draft: { glider: "Tandem", occupancy: "", flightTypes: "tow" } });
});

it("keeps an explicitly unchecked tandem choice while changing wings", () => {
  render(<ManualEntryForm options={options} />);
  fireEvent.change(screen.getByLabelText("Wing"), { target: { value: "Tandem" } });
  const tandem = screen.getByRole("checkbox", { name: "Tandem" });
  fireEvent.click(tandem);
  fireEvent.change(screen.getByLabelText("Wing"), { target: { value: "Solo" } });
  fireEvent.change(screen.getByLabelText("Wing"), { target: { value: "Tandem" } });
  expect(tandem).not.toBeChecked();
});

it("recomputes an inherited flag when editing a flight's wing but preserves an existing override", () => {
  const initial = { ...emptyEntry(), glider: "Tandem", flightTypes: "tandem", occupancy: "tandem" };
  const rendered = render(<ManualEntryForm options={options} initial={initial} flightId="flight" initialTandemOverride={null} />);
  fireEvent.change(screen.getByLabelText("Wing"), { target: { value: "Solo" } });
  expect(screen.getByRole("checkbox", { name: "Tandem" })).not.toBeChecked();
  rendered.unmount();
  render(<ManualEntryForm options={options} initial={initial} flightId="flight" initialTandemOverride />);
  fireEvent.change(screen.getByLabelText("Wing"), { target: { value: "Solo" } });
  expect(screen.getByRole("checkbox", { name: "Tandem" })).toBeChecked();
});
