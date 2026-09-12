import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dropzone } from "./dropzone";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
});

const facts = {
  date: "2024-07-13",
  durationS: 240,
  maxAltM: 860,
  launchAltM: 500,
  altGainM: 360,
  maxClimbMs: 3,
  maxSinkMs: -2,
  takeoffAt: "2024-07-13T10:00:30.000Z",
  landingAt: "2024-07-13T10:04:30.000Z",
  takeoffLat: 37.6685,
  takeoffLon: -122.4936,
  landingLat: 37.67,
  landingLon: -122.47,
};

it("offers attaching to a logbook entry while allowing a separate upload", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body as FormData;
    if (url === "/api/upload" && body.get("allowPossibleDuplicate") === "true") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ filename: "flight.igc", flightId: "new-flight", status: "ready", deduped: false }] }),
      } as Response;
    }
    if (url === "/api/upload") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            filename: "flight.igc",
            possibleDuplicates: [{
              id: "csv-flight",
              date: "2024-07-13",
              time: "10:00–10:05",
              site: "Mussel Rock",
              wing: "Test Wing",
              recordingKind: "logbook",
            }],
          }],
        }),
      } as Response;
    }
    if (body.get("operation") === "preview") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          attached: false,
          mergeable: true,
          hash: "hash",
          expectedUpdatedAt: "2024-07-13T12:00:00.000Z",
          warnings: [],
          previous: { ...facts, durationS: 300, takeoffLat: null, takeoffLon: null },
          recorded: facts,
        }),
      } as Response;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  render(<Dropzone />);

  const file = new File(["igc"], "flight.igc", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("IGC files"), { target: { files: [file] } });

  expect(await screen.findByText("Overlapping flight found")).toBeInTheDocument();
  expect(screen.getByText(/Compare the recording with your existing flight/)).toBeInTheDocument();
  expect(mocks.push).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  expect(await screen.findByRole("columnheader", { name: "Existing flight" })).toBeInTheDocument();
  expect(screen.getByText(/Your wing, flight types, chosen site names, notes, photos/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add uploaded IGC to this flight" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Keep this uploaded flight" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/flights/new-flight"));
  expect(fetch).toHaveBeenCalledTimes(3);
  const keep = fetch.mock.calls[2][1]?.body as FormData;
  expect(keep.get("allowPossibleDuplicate")).toBe("true");
});

it("discards only the upload and leaves the existing flight untouched", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ results: [{ filename: "flight.igc", possibleDuplicates: [{ id: "recorded", date: "2024-07-13", time: "10:00–10:04", site: null, wing: null, recordingKind: "igc" }] }] }),
  } as Response);
  vi.stubGlobal("fetch", fetch);
  render(<Dropzone />);

  const file = new File(["different igc"], "flight.igc");
  fireEvent.change(screen.getByLabelText("IGC files"), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "Discard this upload" }));

  expect(screen.queryByText("Overlapping flight found")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(mocks.push).not.toHaveBeenCalled();
});

it("attaches the reviewed file to the existing id and sends concurrency guards", async () => {
  const preview = { mergeable: true, hash: "verified-hash", expectedUpdatedAt: "2026-09-12T12:00:00.000Z", warnings: [], previous: { ...facts, recorder: null }, recorded: { ...facts, recorder: "XLF123", localUtcOffsetMinutes: -420 } };
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ filename: "found.igc", possibleDuplicates: [{ id: "original", date: facts.date, recordingKind: "logbook" }] }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => preview })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "original", attached: true }) });
  vi.stubGlobal("fetch", fetch);
  render(<Dropzone />);
  const file = new File(["igc"], "found.igc");
  fireEvent.change(screen.getByLabelText("IGC files"), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add uploaded IGC to this flight" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/flights/original"));
  const body = fetch.mock.calls[2][1].body as FormData;
  expect(fetch.mock.calls[2][0]).toBe("/api/flights/original/attach-igc");
  expect(body.get("operation")).toBe("commit");
  expect(body.get("hash")).toBe("verified-hash");
  expect(body.get("expectedUpdatedAt")).toBe(preview.expectedUpdatedAt);
  expect(body.get("file")).toBe(file);
});
