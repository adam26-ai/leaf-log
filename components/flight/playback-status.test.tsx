import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlaybackStatus } from "./playback-bar";

afterEach(cleanup);

it("switches the time display between clock time and elapsed flight time", () => {
  const view = render(<PlaybackStatus time={0} speed={1} takeoffMs={12 * 60 * 60 * 1000} offsetMin={0}
    trackDisplay="elapsed" onSpeed={vi.fn()} onTrackDisplay={vi.fn()} />);
  const toggle = screen.getByRole("button", { name: "Show clock time" });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTitle("Clock time")).toHaveTextContent("12:00:00");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTitle("Flight time from takeoff")).toHaveTextContent("0:00");
  view.rerender(<PlaybackStatus time={75} speed={1} takeoffMs={12 * 60 * 60 * 1000} offsetMin={0}
    trackDisplay="elapsed" onSpeed={vi.fn()} onTrackDisplay={vi.fn()} />);
  expect(screen.getByTitle("Flight time from takeoff")).toHaveTextContent("1:15");
});
