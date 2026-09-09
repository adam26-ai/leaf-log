import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalysisNotice } from "./analysis-notice";
import { AnalysisStatus } from "../flight/analysis-status";
const mocks = vi.hoisted(() => ({ bulk: vi.fn(), single: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/flights/queue-xc-action", () => ({ queueMissingFlightAnalysis: mocks.bulk, queueFlightXc: mocks.single }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const flight = { id: "f", status: "ready", metricsVersion: 1, xcStatus: "unscored", xcScore: null };
beforeEach(() => { vi.clearAllMocks(); mocks.bulk.mockResolvedValue({ count: 1 }); });
it("offers a single bulk action and refreshes after queueing", async () => {
  render(<AnalysisNotice flights={[flight, { ...flight, id: "g" }]} now={0} />);
  expect(screen.getByText(/2 flights need XC/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Calculate missing XC" }));
  await waitFor(() => expect(mocks.bulk).toHaveBeenCalledWith("xc"));
  expect(mocks.refresh).toHaveBeenCalled();
});
it("shows no action to viewers or for missing originals", () => {
  render(<><AnalysisStatus flight={flight} /><AnalysisStatus flight={{ ...flight, xcStatus: "unavailable" }} owner /></>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
});
it("keeps delayed queue guidance concise and accessible without a tooltip", () => {
  render(<AnalysisNotice flights={[{ ...flight, xcStatus: "queued", xcQueuedAt: new Date(0) }]} now={130000} />);
  expect(screen.getByRole("status")).toHaveTextContent("1 waiting");
  expect(screen.getByText(/Work resumes when the server is available/)).toBeInTheDocument();
});
