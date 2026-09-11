// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { XcAnalysis } from "./xc-result";

const source = readFileSync(new URL("./xc-worker.cjs", import.meta.url), "utf8");
const rule = { code: "fai", name: "FAI Triangle", multiplier: 1.4 };
const unfinished = { optimal: false, scoreInfo: { score: 0 } };
const route = {
  optimal: false,
  scoreInfo: { score: 1.4, distance: 1, tp: [] },
};

function run(values: unknown[]) {
  const messages: (XcAnalysis | { progress: XcAnalysis })[] = [];
  const next = vi.fn(() => {
    if (!values.length) throw new Error("Search continued past its result");
    return { value: values.shift() };
  });
  const solver = vi.fn(() => ({ next }));
  runInNewContext(source, {
    require: (name: string) => {
      if (name === "igc-xc-score") return { solver, scoringRules: { XContest: [rule] } };
      if (name === "node:worker_threads") return {
        parentPort: { postMessage: (message: typeof messages[number]) => messages.push(message) },
        workerData: { fixes: [], completedCategories: ["open", "free-triangle"], improve: true },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return { messages, solver, next, result: messages.at(-1) as XcAnalysis };
}

describe("XC worker search continuation", () => {
  it("continues the same search past empty slices until a valid best-found route exists", () => {
    const { solver, next, result } = run([unfinished, unfinished, route]);
    expect(solver).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ complete: true, completedCategories: ["open", "free-triangle", "fai-triangle"],
      score: { approximate: true, best: { shape: "fai-triangle", distanceM: 1000, optimal: false } } });
  });

  it("stops when the search proves there is no eligible route", () => {
    const { result } = run([unfinished, { optimal: true, scoreInfo: { score: 0 } }]);
    expect(result).toMatchObject({ complete: true, score: null, emptyReason: "no_eligible_route" });
  });

  it("publishes existing category coverage before a potentially long search", () => {
    const { messages } = run([route]);
    expect(messages[0]).toMatchObject({ progress: {
      complete: false, completedCategories: ["open", "free-triangle"], score: null,
    } });
  });
});
