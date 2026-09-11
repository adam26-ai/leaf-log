/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node worker uses CommonJS outside Next's bundler. */
// Keep the optimizer's mutable geometry caches isolated from concurrent uploads.
const { parentPort, workerData } = require("node:worker_threads");
const { solver, scoringRules } = require("igc-xc-score");

const candidates = [];
const categories = ["open", "free-triangle", "fai-triangle"];
const completed = new Set(workerData.completedCategories || []);
const categoryOf = rule => rule.code === "od" ? "open" : rule.code === "fai" ? "fai-triangle" : "free-triangle";
function result() {
  const ranked = [...candidates].sort((a, b) => b.points - a.points || b.distanceM - a.distanceM);
  const complete = categories.every(category => completed.has(category));
  return { score: ranked.length ? { version: 1, rules: "XContest", best: ranked[0], candidates: ranked,
    approximate: !complete || ranked.some(route => !route.optimal) } : null,
    completedCategories: [...completed], complete,
    ...(!ranked.length && complete ? { emptyReason: "no_eligible_route" } : {}) };
}
parentPort.postMessage({ progress: result() });
for (const category of categories) {
  if (completed.has(category)) continue;
  let unresolved = false;
  for (const rule of scoringRules.XContest.filter(rule => categoryOf(rule) === category)) {
  const iterator = solver({ fixes: workerData.fixes }, [rule], {
    maxcycle: workerData.improve ? 5000 : 1500, hp: true, trim: false,
  });
  // A slice ending without a route is unfinished search, not an empty result.
  // Keep the same iterator alive until it finds a route or proves none exists;
  // the parent worker deadline still bounds the entire calculation.
  let value;
  let info;
  do {
    ({ value } = iterator.next());
    info = value?.scoreInfo;
  } while (value && !value.optimal && (!info || !Number.isFinite(info.score) || info.score <= 0));
  if (!info || !Number.isFinite(info.score) || info.score <= 0) {
    unresolved ||= !value?.optimal;
    continue;
  }
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
  parentPort.postMessage({ progress: result() });
  }
  if (!unresolved) completed.add(category);
  parentPort.postMessage({ progress: result() });
}
parentPort.postMessage(result());
