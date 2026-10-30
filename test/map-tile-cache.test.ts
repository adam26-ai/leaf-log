// @vitest-environment node
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const tile = "https://tiles.openfreemap.org/planet/10/1/2.pbf";
function worker(options: { cacheControl?: string; quotaFailure?: boolean; small?: boolean } = {}) {
  const entries = new Map<string, Response>();
  const metadata = new Map<string, Response>();
  const listeners: Record<string, (event: unknown) => void> = {};
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const cacheFor = (entries: Map<string, Response>) => ({
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    match: async (key: Request) => entries.get(key.url)?.clone(),
    put: async (key: Request, response: Response) => {
      if (options.quotaFailure) throw new Error("quota");
      entries.set(key.url, response.clone());
    },
    delete: async (key: Request | string) => entries.delete(typeof key === "string" ? key : key.url),
  });
  const fetch = vi.fn(async () => new Response("map tile", { headers: { "cache-control": options.cacheControl ?? "public, max-age=3600", date: new Date(now).toUTCString() } }));
  const context = createContext({ URL, Request, Response, Headers, Date: Clock, Map, Promise,
    caches: { open: async (name: string) => cacheFor(name === "leaf-map-tiles-v1" ? entries : metadata), delete: async (name: string) => { (name === "leaf-map-tiles-v1" ? entries : metadata).clear(); return true; }, keys: async () => [] },
    fetch, self: { addEventListener: (type: string, callback: (event: unknown) => void) => { listeners[type] = callback; } },
  });
  let source = readFileSync("public/map-tile-cache.js", "utf8");
  if (options.small) source = source.replace("const MAX_ENTRIES = 1500;", "const MAX_ENTRIES = 3;").replace("const MAX_BYTES = 128 * 1024 * 1024;", "const MAX_BYTES = 16;");
  runInContext(source, context);
  return { entries, fetch, advance: (ms: number) => { now += ms; },
    async request(url = tile, init?: RequestInit) {
      let response: Promise<Response> | undefined;
      const tasks: Promise<unknown>[] = [];
      listeners.fetch({ request: new Request(url, init), respondWith: (result: Promise<Response>) => { response = result; }, waitUntil: (task: Promise<unknown>) => tasks.push(task) });
      const result = await response;
      await Promise.all(tasks);
      return result;
    },
  };
}

describe("public map tile cache", () => {
  it("reuses tiles across flights without caching application data", async () => {
    const w = worker();
    expect(await (await w.request())!.text()).toBe("map tile");
    expect(await (await w.request())!.text()).toBe("map tile");
    expect(w.fetch).toHaveBeenCalledTimes(1);
    for (const url of ["https://log.leafvario.com/api/flights/private/replay", "https://log.leafvario.com/sign-in", "https://other.example/planet/1.pbf", "https://tiles.openfreemap.org.evil.test/planet/x", "https://api.maptiler.com/geocoding/query.json"]) expect(await w.request(url)).toBeUndefined();
    expect(w.fetch).toHaveBeenCalledTimes(1);
  });

  it("honors provider expiry, age, no-cache, no-store and explicit reloads", async () => {
    const w = worker();
    await w.request();
    w.advance(3600_001);
    await w.request();
    expect(w.fetch).toHaveBeenCalledTimes(2);
    await w.request(tile, { cache: "reload" });
    expect(w.fetch).toHaveBeenCalledTimes(3);
    for (const policy of ["no-store, max-age=3600", "private, max-age=3600", "no-cache, max-age=3600", "public"]) {
      const uncached = worker({ cacheControl: policy });
      await uncached.request(); await uncached.request();
      expect(uncached.entries.size).toBe(0);
      expect(uncached.fetch).toHaveBeenCalledTimes(2);
    }
    expect(await w.request(tile, { cache: "no-store" })).toBeUndefined();
    expect(await w.request(tile, { headers: { range: "bytes=0-100" } })).toBeUndefined();
  });

  it("bounds storage during bursts and falls back cleanly on quota errors", async () => {
    const w = worker({ small: true });
    await Promise.all(Array.from({ length: 6 }, (_, i) => w.request(`${tile}?tile=${i}`)));
    expect(w.entries.size).toBe(2); // Each tile is 8 bytes; byte bound wins.
    expect([...w.entries.keys()]).toEqual([`${tile}?tile=4`, `${tile}?tile=5`]);
    const full = worker({ quotaFailure: true });
    expect(await (await full.request())!.text()).toBe("map tile");
    expect(full.entries.size).toBe(0);
  });

  it("includes terrain and keyed satellite tiles, keeping full cache keys", async () => {
    const w = worker();
    for (const url of ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/1/2.png", "https://api.maptiler.com/tiles/satellite-v2/10/1/2.jpg?key=one", "https://api.maptiler.com/tiles/satellite-v2/10/1/2.jpg?key=two"]) {
      await w.request(url); await w.request(url);
    }
    expect(w.fetch).toHaveBeenCalledTimes(3);
    expect(w.entries.size).toBe(3);
    const terrain = worker({ cacheControl: "" });
    const url = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/1/2.png";
    await terrain.request(url); await terrain.request(url);
    expect(terrain.fetch).toHaveBeenCalledTimes(1);
    terrain.advance(7 * 24 * 3600_000 + 1);
    await terrain.request(url);
    expect(terrain.fetch).toHaveBeenCalledTimes(2);
  });
});
