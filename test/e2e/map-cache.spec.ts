import { test, expect } from "./fixtures";
import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("public map tiles survive a browser restart and keep private requests out", async ({ baseURL, prepareContext }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "leaf-map-cache-"));
  const tile = "https://tiles.openfreemap.org/planet-test/10/1/2.pbf";
  let downloads = 0;
  let workerRequests = 0;
  async function open() {
    const context = await chromium.launchPersistentContext(directory, { headless: true, channel: (testInfo.project.use as { channel?: string }).channel ?? "chromium", serviceWorkers: "allow" });
    await prepareContext(context, { observeCache: true });
    context.on("request", request => { if (request.serviceWorker() && request.url() === tile) workerRequests++; });
    if (!downloads) await context.route(tile, async route => {
      downloads++;
      await route.fulfill({ body: "cached map tile", headers: {
        "content-type": "application/x-protobuf", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600", "expires": new Date(Date.now() + 3600_000).toUTCString(),
      } });
    });
    const page = context.pages()[0];
    await page.goto(`${baseURL}/sign-in`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    return { context, page };
  }
  let current: Awaited<ReturnType<typeof open>> | undefined;
  try {
    current = await open();
    expect(await current.page.evaluate(url => fetch(url).then(response => response.text()), tile)).toBe("cached map tile");
    await expect.poll(() => current!.page.evaluate(async url => {
      const [body, metadata] = await Promise.all([caches.open("leaf-map-tiles-v1").then(cache => cache.match(url)), caches.open("leaf-map-metadata-v1").then(cache => cache.match(url))]);
      return Boolean(body && metadata);
    }, tile)).toBe(true);
    expect(downloads).toBe(1);
    expect(workerRequests).toBe(1);
    await current.context.close();
    current = await open();
    expect(await current.page.evaluate(url => fetch(url).then(response => response.text()), tile)).toBe("cached map tile");
    expect(downloads).toBe(1);
    expect(workerRequests).toBe(1);
    await current.page.evaluate(() => fetch("/api/flights/not-a-flight/replay"));
    const keys = await current.page.evaluate(async () => (await (await caches.open("leaf-map-tiles-v1")).keys()).map(request => request.url));
    expect(keys).toEqual([tile]);
    await testInfo.attach("cache-evidence", { body: JSON.stringify({ browserSessions: 2, downloads, cachedUrls: keys }), contentType: "application/json" });
  } finally {
    await current?.context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
