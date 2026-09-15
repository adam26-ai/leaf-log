import { test as base, expect, type BrowserContext } from "@playwright/test";
import sharp from "sharp";

export { expect };
export type { Page, Locator } from "@playwright/test";

// Keep the real MapLibre/deck.gl renderer and terrain pipeline. Only replace
// third-party data, which must not depend on credentials, CDN uptime or region.
const emptyStyle = { version: 8, sources: {}, layers: [] };
const flatTerrainTile = sharp({ create: {
  width: 256, height: 256, channels: 3, background: { r: 128, g: 0, b: 0 },
} }).png().toBuffer();

type Fixtures = {
  prepareContext: (context: BrowserContext) => Promise<void>;
  newContext: () => Promise<BrowserContext>;
};

export const test = base.extend<Fixtures>({
  prepareContext: async ({ baseURL }, provide, testInfo) => {
    const unexpected = new Set<string>();
    const diagnostics: string[] = [];
    const origin = new URL(baseURL!).origin;
    await provide(async context => {
      context.on("requestfailed", request => {
        diagnostics.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
      });
      context.on("response", response => {
        if (response.status() >= 400) diagnostics.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      context.on("weberror", error => diagnostics.push(`Page error: ${error.error().message}`));
      await context.route(/^https?:\/\//, async route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if ((url.hostname === "tiles.openfreemap.org" && url.pathname.startsWith("/styles/")) ||
            (url.hostname === "api.maptiler.com" && /^\/maps\/[^/]+\/style\.json$/.test(url.pathname))) {
          return route.fulfill({ json: emptyStyle });
        }
        if (url.hostname === "s3.amazonaws.com" && url.pathname.startsWith("/elevation-tiles-prod/terrarium/")) {
          return route.fulfill({ contentType: "image/png", body: await flatTerrainTile });
        }
        // Page routes (e.g. the place-search fixture) take precedence. Unknown
        // dependencies fail with their address instead of a later UI timeout.
        unexpected.add(`${url.origin}${url.pathname}`);
        await route.abort("blockedbyclient");
      });
    });
    if (testInfo.status !== testInfo.expectedStatus || unexpected.size) {
      await testInfo.attach("browser-diagnostics", {
        body: JSON.stringify({ unexpectedExternalRequests: [...unexpected], diagnostics }, null, 2),
        contentType: "application/json",
      });
    }
    expect([...unexpected], "Add an explicit fixture for external browser dependencies").toEqual([]);
  },
  context: async ({ context, prepareContext }, provide) => {
    await prepareContext(context);
    await provide(context);
  },
  newContext: async ({ browser, prepareContext }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      await prepareContext(context);
      return context;
    });
    // Also closes secondary pilots on assertion failures, before the next test.
    await Promise.all(contexts.map(context => context.close()));
  },
});
