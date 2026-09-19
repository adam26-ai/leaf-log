import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AddFlightForm } from "./add-flight-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const options = { wings: [], tandemWings: [], sites: [], siteNames: [] };

it("uses a single flight-type selection for manual entries and IGC uploads", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "manual", results: [{ flightId: "igc" }] }) });
  vi.stubGlobal("fetch", fetch);
  render(<AddFlightForm options={options} imperial={false} />);
  expect(screen.getAllByRole("group", { name: "Flight type (select all that apply)" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Tandem" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Tow" }));
  fireEvent.change(screen.getByLabelText("IGC files"), { target: { files: [new File(["igc"], "flight.igc")] } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const upload = fetch.mock.calls[0][1].body as FormData;
  expect(upload.getAll("flightFlags")).toEqual(["tandem", "tow"]);
  expect(upload.get("tandemOverride")).toBe("true");
  fireEvent.change(screen.getByLabelText("Flight date"), { target: { value: "2024-07-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Add manual flight" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ tandemTouched: true, draft: { flightTypes: "tandem;tow", occupancy: "tandem" } });
});

it("keeps explicit solo intent across other field edits before uploading", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ flightId: "igc" }] }) });
  vi.stubGlobal("fetch", fetch);
  render(<AddFlightForm options={options} imperial={false} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Tandem" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Tandem" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "SIV" }));
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Remember this" } });
  fireEvent.change(screen.getByLabelText("IGC files"), { target: { files: [new File(["igc"], "flight.igc")] } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const upload = fetch.mock.calls[0][1].body as FormData;
  expect(upload.getAll("flightFlags")).toEqual(["siv"]);
  expect(upload.get("tandemOverride")).toBe("false");
});
