import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AccentBar } from "./accent-bar";

describe("AccentBar", () => {
  it("renders the signature 3px amber bar", () => {
    const { container } = render(<AccentBar />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toBeInTheDocument();
    expect(bar.className).toContain("bg-amber");
    expect(bar.className).toContain("h-[3px]");
    expect(bar).toHaveAttribute("aria-hidden");
  });

  it("accepts a custom width", () => {
    const { container } = render(<AccentBar width="5rem" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.style.width).toBe("5rem");
  });
});
