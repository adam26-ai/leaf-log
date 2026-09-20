import { Deck, OrthographicView } from "@deck.gl/core";
import { LineLayer } from "@deck.gl/layers";
import { MultiColorPathLayer, type MultiColorPathDatum } from "./multi-color-path-layer";

const CANARY_WIDTH = 64;
const CANARY_HEIGHT = 40;
const CANARY_TIMEOUT_MS = 3_000;
const CANARY_CACHE_KEY = "leaf-log:track-renderer-canary:v1";
const MIN_VISIBLE_PIXELS = 8;

export type TrackRendererCanaryOutcome = "pass" | "fail" | "inconclusive";

export interface TrackRendererCanaryResult {
  outcome: TrackRendererCanaryOutcome;
  source: "live" | "session-cache";
  controlPixels: number;
  productionPixels: number;
  detail: string;
}

interface CanaryPixelCounts {
  controlPixels: number;
  productionPixels: number;
}

/**
 * The stock LineLayer is the known-good control on affected Samsung devices.
 * Only select the fallback when that control rendered but the production
 * PathLayer pipeline did not. An unavailable WebGL context or a wholly blank
 * frame is inconclusive and must not silently downgrade every visitor.
 */
export function classifyTrackRendererCanary({
  controlPixels,
  productionPixels,
}: CanaryPixelCounts): TrackRendererCanaryOutcome {
  if (controlPixels < MIN_VISIBLE_PIXELS) return "inconclusive";
  return productionPixels < MIN_VISIBLE_PIXELS ? "fail" : "pass";
}

function countCanaryPixels(pixels: Uint8Array): CanaryPixelCounts {
  let controlPixels = 0;
  let productionPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const alpha = pixels[offset + 3];
    if (alpha < 64) continue;
    if (red > 128 && blue > 128 && green < 112) controlPixels++;
    if (green > 128 && red < 112 && blue < 112) productionPixels++;
  }
  return { controlPixels, productionPixels };
}

function cachedResult(): TrackRendererCanaryResult | null {
  try {
    const value = sessionStorage.getItem(CANARY_CACHE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as TrackRendererCanaryResult;
    if (parsed.outcome !== "pass" && parsed.outcome !== "fail") return null;
    return { ...parsed, source: "session-cache" };
  } catch {
    return null;
  }
}

function cacheResult(result: TrackRendererCanaryResult) {
  if (result.outcome === "inconclusive") return;
  try {
    sessionStorage.setItem(CANARY_CACHE_KEY, JSON.stringify(result));
  } catch {
    // Private browsing and storage policies may deny sessionStorage.
  }
}

function resultForCounts(counts: CanaryPixelCounts): TrackRendererCanaryResult {
  const outcome = classifyTrackRendererCanary(counts);
  return {
    outcome,
    source: "live",
    ...counts,
    detail: outcome === "pass"
      ? "stock-line control and production path both rendered"
      : outcome === "fail"
        ? "stock-line control rendered but production path was blank"
        : "stock-line control did not produce a readable frame",
  };
}

/** Render the known-good primitive and the production path pipeline into a
 * tiny detached canvas, then inspect their deliberately distinct fill colors.
 * The canvas is never attached to the document, so the test cannot flash in
 * the map or affect its shared MapLibre WebGL context. */
export async function runTrackRendererCanary(): Promise<TrackRendererCanaryResult> {
  const cached = cachedResult();
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = CANARY_WIDTH;
  canvas.height = CANARY_HEIGHT;

  const productionDatum: MultiColorPathDatum = {
    path: [[-24, 9, 0], [0, 9, 0], [24, 9, 0]],
    colors: [[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255]],
  };

  return new Promise((resolve) => {
    let deck: Deck<OrthographicView> | null = null;
    let settled = false;
    let renderedFrames = 0;

    const finish = (result: TrackRendererCanaryResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cacheResult(result);
      resolve(result);
      // Finalizing inside deck.gl's render callback can invalidate the active
      // frame. Defer cleanup until the callback has unwound.
      window.setTimeout(() => deck?.finalize(), 0);
    };

    const timeout = window.setTimeout(() => {
      finish({
        outcome: "inconclusive",
        source: "live",
        controlPixels: 0,
        productionPixels: 0,
        detail: `canary did not finish within ${CANARY_TIMEOUT_MS} ms`,
      });
    }, CANARY_TIMEOUT_MS);

    try {
      deck = new Deck<OrthographicView>({
        id: "track-renderer-canary",
        canvas,
        width: CANARY_WIDTH,
        height: CANARY_HEIGHT,
        useDevicePixels: false,
        views: new OrthographicView({
          id: "canary",
          flipY: false,
          clear: true,
          clearColor: [0, 0, 0, 0],
        }),
        initialViewState: { target: [0, 0, 0], zoom: 0 },
        controller: false,
        parameters: { depthCompare: "always", depthWriteEnabled: false },
        layers: [
          new LineLayer<{ source: number[]; target: number[] }>({
            id: "track-renderer-canary-control",
            data: [{ source: [-24, -9, 0], target: [24, -9, 0] }],
            getSourcePosition: (segment) => segment.source as [number, number, number],
            getTargetPosition: (segment) => segment.target as [number, number, number],
            getColor: [255, 0, 255, 255],
            getWidth: 6,
            widthUnits: "pixels",
            widthMinPixels: 6,
          }),
          new MultiColorPathLayer({
            id: "track-renderer-canary-production",
            data: [productionDatum],
            getPath: (datum) => datum.path as [number, number, number][],
            getColor: (datum) => datum.colors,
            getWidth: 6,
            widthUnits: "pixels",
            widthMinPixels: 6,
            billboard: true,
            capRounded: true,
            jointRounded: true,
          }),
        ],
        onAfterRender: ({ gl }) => {
          // The initial callback may precede attribute upload on slower GPUs.
          // Reading the second completed frame keeps the decision deterministic.
          renderedFrames++;
          if (renderedFrames < 2) {
            deck?.redraw("read track renderer canary on the next frame");
            return;
          }
          const pixels = new Uint8Array(CANARY_WIDTH * CANARY_HEIGHT * 4);
          gl.readPixels(0, 0, CANARY_WIDTH, CANARY_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          finish(resultForCounts(countCanaryPixels(pixels)));
        },
        onError: (error) => {
          finish({
            outcome: "inconclusive",
            source: "live",
            controlPixels: 0,
            productionPixels: 0,
            detail: `canary renderer error: ${error.message}`,
          });
        },
      });
    } catch (error) {
      finish({
        outcome: "inconclusive",
        source: "live",
        controlPixels: 0,
        productionPixels: 0,
        detail: `canary setup error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}
