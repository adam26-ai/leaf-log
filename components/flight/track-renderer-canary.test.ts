import { describe, expect, it } from "vitest";
import { classifyTrackRendererCanary } from "./track-renderer-canary";

describe("classifyTrackRendererCanary", () => {
  it("keeps the production renderer when both pipelines draw", () => {
    expect(classifyTrackRendererCanary({ controlPixels: 120, productionPixels: 96 }))
      .toBe("pass");
  });

  it("selects the fallback only when the control draws and production is blank", () => {
    expect(classifyTrackRendererCanary({ controlPixels: 120, productionPixels: 0 }))
      .toBe("fail");
  });

  it("does not downgrade on a blank or unreadable control frame", () => {
    expect(classifyTrackRendererCanary({ controlPixels: 0, productionPixels: 0 }))
      .toBe("inconclusive");
  });
});
