/* Public map resources only. No pages, API responses, photos, or flight tracks.
 * Keep normal provider URLs/keys and freshness; never download unseen areas. */
const CACHE_NAME = "leaf-map-tiles-v1";
const METADATA_NAME = "leaf-map-metadata-v1";
const MAX_ENTRIES = 1500;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let writes = Promise.resolve();

function isMapResource(request) {
  if (request.method !== "GET" || request.cache === "no-store" || request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.protocol !== "https:") return false;
  if (url.hostname === "tiles.openfreemap.org") {
    return /^\/(?:planet[^/]*\/|fonts\/|sprites\/)/.test(url.pathname);
  }
  if (url.hostname === "api.maptiler.com") {
    return /^\/(?:tiles\/|fonts\/)/.test(url.pathname) || /^\/maps\/[^/]+\/sprite[^/]*\.(?:json|png)$/.test(url.pathname);
  }
  return url.hostname === "s3.amazonaws.com" && /^\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/.test(url.pathname);
}

function expiresAt(response, now, request) {
  const policy = response.headers.get("cache-control") || "";
  if (!response.ok || response.type === "opaque" || /(?:^|,)\s*(?:no-store|no-cache|private)\b/i.test(policy) || response.headers.get("vary") === "*") return 0;
  const maxAge = policy.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i);
  // The openly licensed Terrain Tiles dataset has no HTTP freshness policy.
  // Retain only viewed tiles for seven days. All commercial resources require
  // explicit provider freshness, including a CORS-visible absolute timestamp.
  if (!policy && new URL(request.url).hostname === "s3.amazonaws.com") return now + MAX_AGE_MS;
  if (!maxAge) return 0;
  const date = Date.parse(response.headers.get("date") || "");
  const expires = Date.parse(response.headers.get("expires") || "");
  // Expires is CORS-safelisted; Date/Age sometimes aren't exposed. Never
  // restart a provider TTL just because fetch returned a browser-cached tile.
  if (!Number.isFinite(date) && !Number.isFinite(expires)) return 0;
  const age = Math.max(Number(response.headers.get("age") || 0) * 1000, Number.isFinite(date) ? now - date : 0);
  return Math.min(now + Math.max(0, Math.min(MAX_AGE_MS, Number(maxAge[1]) * 1000 - age)), Number.isFinite(expires) ? expires : Infinity);
}

async function store(request, response, expiry) {
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength > MAX_ENTRY_BYTES) return;
  const cache = await caches.open(CACHE_NAME);
  const metadata = await caches.open(METADATA_NAME);
  // Keep an in-memory index for this worker lifetime instead of scanning disk
  // on every tile. Rebuild after eviction or worker restart.
  if (!store.entries) {
    store.entries = new Map();
    for (const key of await metadata.keys()) {
      const entry = await (await metadata.match(key))?.json();
      if (!entry || entry.expiry <= Date.now()) {
        await cache.delete(key);
        await metadata.delete(key);
      } else store.entries.set(key.url, entry.bytes);
    }
  }
  const entries = store.entries;
  let total = [...entries.values()].reduce((sum, size) => sum + size, 0) - (entries.get(request.url) || 0);
  entries.delete(request.url);
  for (const [url, size] of entries) {
    if (entries.size < MAX_ENTRIES && total + bytes.byteLength <= MAX_BYTES) break;
    await cache.delete(url);
    await metadata.delete(url);
    entries.delete(url);
    total -= size;
  }
  try {
    // Preserve the original CORS response type, URL and headers. Reconstructing
    // a Response makes cached cross-origin fetches fail in real browsers.
    await cache.put(request, response);
    await metadata.put(request, new Response(JSON.stringify({ expiry, bytes: bytes.byteLength })));
    entries.set(request.url, bytes.byteLength);
  } catch {
    // Quota pressure should cost a cache miss, never a missing map.
    store.entries = undefined;
    await caches.delete(CACHE_NAME);
    await caches.delete(METADATA_NAME);
  }
}

async function mapResponse(event) {
  const request = event.request;
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const metadata = await caches.open(METADATA_NAME);
    const [cached, info] = await Promise.all([cache.match(request), metadata.match(request)]);
    const expiry = info ? (await info.json()).expiry : 0;
    // Reloads and revalidation requests retain their normal HTTP semantics.
    if (request.cache !== "reload" && request.cache !== "no-cache" && cached && expiry > Date.now()) return cached;
  } catch { /* Storage may be disabled; fetch still works. */ }
  const response = await fetch(request);
  const expiry = expiresAt(response, Date.now(), request);
  if (expiry > Date.now()) {
    const copy = response.clone();
    // Serialize writes so count/byte bounds also hold during tile bursts.
    writes = writes.catch(() => {}).then(() => store(request, copy, expiry)).catch(() => {});
    event.waitUntil(writes);
  } else if (cache) {
    event.waitUntil(Promise.all([cache.delete(request), caches.open(METADATA_NAME).then(metadata => metadata.delete(request))]).catch(() => {}));
  }
  return response;
}

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if ((key.startsWith("leaf-map-tiles-") || key.startsWith("leaf-map-metadata-")) && key !== CACHE_NAME && key !== METADATA_NAME) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  if (isMapResource(event.request)) event.respondWith(mapResponse(event));
});
self.addEventListener("message", event => {
  if (event.data === "leaf-clear-map-cache") store.entries = undefined;
});
