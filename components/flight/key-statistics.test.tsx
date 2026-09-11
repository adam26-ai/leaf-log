import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlightStatistics } from "@/lib/flights/statistics";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, queue: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/flights/queue-xc-action", () => ({ queueFlightXc: mocks.queue, queueMissingFlightAnalysis: vi.fn() }));
import { KeyStatistics } from "./key-statistics";

const flight: FlightStatistics = { id: "own-second", glider: "Wing", durationS: 600, maxAltM: 500,
  altGainM: 300, maxClimbMs: 3, maxSinkMs: -2, status: "ready", xcStatus: "unscored",
  xcError: null, xcScore: null, metricsVersion: METRICS_VERSION };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("queues XC for the displayed own flight and refreshes its replay statistics", async () => {
  const refresh = vi.fn();
  const { rerender } = render(<KeyStatistics flight={flight} canCalculateXc onRefresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate XC" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(mocks.queue).toHaveBeenCalledWith(flight.id);
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  rerender(<KeyStatistics flight={{ ...flight, id: "friend-flight" }} friend />);
  expect(screen.queryByRole("button", { name: "Calculate XC" })).not.toBeInTheDocument();
});

it("polls the selected companion's statistics while its XC calculation is pending", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const { rerender } = render(<KeyStatistics flight={{ ...flight, xcStatus: "processing" }} onRefresh={refresh} />);
  act(() => vi.advanceTimersByTime(5000));
  expect(refresh).toHaveBeenCalledOnce();
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  rerender(<KeyStatistics flight={flight} onRefresh={refresh} />);
  act(() => vi.advanceTimersByTime(5000));
  expect(refresh).toHaveBeenCalledOnce();
});
