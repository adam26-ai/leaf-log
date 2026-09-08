/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node worker uses CommonJS outside Next's bundler. */
// Keep the optimizer's mutable geometry caches isolated from concurrent uploads.
const { parentPort, workerData } = require("node:worker_threads");
const { solver, scoringRules } = require("igc-xc-score");

const candidates = [];
let approximate = false;
for (const rule of scoringRules.XContest) {
  const iterator = solver({ fixes: workerData.fixes }, [rule], {
    maxcycle: 1500, hp: true, trim: false,
  });
  const { value } = iterator.next();
  approximate ||= !value?.optimal;
  const info = value?.scoreInfo;
  if (!info || !Number.isFinite(info.score) || info.score <= 0) continue;
  const point = (p) => ({ lat: p.y, lon: p.x, timeMs: value.opt.flight.filtered[p.r].timestamp });
  const vertices = (info.tp || []).map(point);
  candidates.push({
    shape: rule.code === "od" ? "open" : rule.code === "fai" ? "fai-triangle" : "free-triangle",
    name: rule.name,
    distanceM: Math.round(Math.max(0, info.distance - (info.penalty || 0)) * 1000),
    points: info.score,
    multiplier: rule.multiplier,
    optimal: !!value.optimal,
    closingGapM: Math.round((info.cp?.d || 0) * 1000),
    vertices,
    start: info.ep ? point(info.ep.start) : info.cp ? point(info.cp.in) : null,
    finish: info.ep ? point(info.ep.finish) : info.cp ? point(info.cp.out) : null,
  });
}
candidates.sort((a, b) => b.points - a.points || b.distanceM - a.distanceM);
parentPort.postMessage(candidates.length ? {
  version: 1, rules: "XContest", approximate,
  best: candidates[0], candidates,
} : null);
