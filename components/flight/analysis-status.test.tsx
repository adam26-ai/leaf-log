import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { METRICS_VERSION, XC_CATEGORIES, XC_SCORING_VERSION } from "@/lib/flights/analysis-state";
import { AnalysisStatus } from "./analysis-status";

const mocks = vi.hoisted(() => ({ queue: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/flights/queue-xc-action", () => ({ queueFlightXc: mocks.queue, queueMissingFlightAnalysis: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.queue.mockResolvedValue({}); });
afterEach(cleanup);
const flight = { id: "flight", status: "ready", xcStatus: "unscored", xcScore: null, metricsVersion: METRICS_VERSION };
const complete = { version: 1, scoringVersion: XC_SCORING_VERSION, complete: true, completedCategories: [...XC_CATEGORIES], best: null, candidates: [], emptyReason: "no_eligible_route" };

it.each([
  [{ xcStatus: "unscored" }, "Calculate XC"],
  [{ xcStatus: "failed" }, "Retry XC"],
  [{ xcStatus: "ready", metricsVersion: METRICS_VERSION - 1 }, "Repair flight data"],
  [{ xcStatus: "ready" }, "Update XC"],
  [{ xcStatus: "partial", xcScore: { ...complete, complete: false } }, "Complete XC"],
])("offers a working per-flight action for %s", async (patch, label) => {
  render(<AnalysisStatus flight={{ ...flight, ...patch }} compact owner />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(mocks.queue).toHaveBeenCalledWith("flight"));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("shows queued and running work, then removes the notice when it finishes", () => {
  const { rerender, container } = render(<AnalysisStatus flight={{ ...flight, xcStatus: "queued" }} compact owner />);
  expect(screen.getByText("Waiting")).toBeInTheDocument();
  rerender(<AnalysisStatus flight={{ ...flight, xcStatus: "processing" }} compact owner />);
  expect(screen.getByText("Calculating\u2026")).toBeInTheDocument();
  rerender(<AnalysisStatus flight={{ ...flight, xcStatus: "ready", xcScore: complete }} compact owner />);
  expect(container).toBeEmptyDOMElement();
});

const route = { shape: "open", distanceM: 1000, optimal: true };
const scored = { ...complete, best: route, candidates: [route] };

it.each([
  { xcStatus: "ready", xcScore: scored },
  { xcStatus: "ready", xcScore: { ...scored, approximate: true } },
  { recordingKind: "logbook" },
  { recordingKind: "logbook", reportedXcDistanceM: 1000, reportedXcType: "open" },
  { xcStatus: "unavailable" },
  { status: "failed", xcStatus: "ready" },
  { xcStatus: "ready", xcScore: complete },
])("does not leave a persistent compact notice for %s", patch => {
  const { container } = render(<AnalysisStatus flight={{ ...flight, ...patch }} compact owner />);
  expect(container).toBeEmptyDOMElement();
});

it("keeps a failed queue request actionable and displays the error", async () => {
  mocks.queue.mockResolvedValue({ error: "Please try again." });
  render(<AnalysisStatus flight={flight} compact owner />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate XC" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Please try again.");
  expect(screen.getByRole("button", { name: "Calculate XC" })).toBeEnabled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
