import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TrophyPill } from "./trophy-pill";
import type { FlightTrophy } from "@/lib/flights/trophies";

afterEach(cleanup);
it.each([
  [[3, 2], "silver"], [[2, 1], "gold"], [[1, 2], "gold"], [[3, 3], "bronze"],
] as const)("uses the highest medal in %s", (ranks, medal) => {
  const trophies: FlightTrophy[] = ranks.map((rank, index) => ({ rank, category: index ? "altitude" : "duration", value: index ? 1500 : 3600, approximate: false }));
  const { container } = render(<TrophyPill trophies={trophies} />);
  expect(container.querySelector("[data-medal]")).toHaveAttribute("data-medal", medal);
  expect(screen.getByText("Personal Bests")).toBeInTheDocument();
  expect(screen.getByText("1h 00m")).toBeInTheDocument();
  expect(screen.getByText("1,500 m")).toBeInTheDocument();
});
