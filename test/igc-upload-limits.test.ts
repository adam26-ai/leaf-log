// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { POST as deviceUpload } from "@/app/api/ingest/route";
import { POST as webUpload } from "@/app/api/upload/route";
import { POST as attachUpload } from "@/app/api/flights/[id]/attach-igc/route";

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  findFlight: vi.fn(),
  touchToken: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  profile: { findUnique: async () => ({ id: "owner" }) },
  flight: { findFirst: mocks.findFlight },
} }));
vi.mock("@/lib/ingest/ingest-flight", () => ({ ingestFlight: mocks.ingest, PARSER_VERSION: "5" }));
vi.mock("@/lib/logbook/igc-duplicates", () => ({ inspectIgcDuplicates: async () => ({ exact: null, candidates: [] }) }));
vi.mock("@/lib/devices/repo", () => ({
  resolveDeviceTokenOwner: async () => ({ ownerId: "owner", tokenId: "token", account: {} }),
  touchDeviceToken: mocks.touchToken,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Use literal boundary sizes so a mistaken shared limit cannot make the tests pass.
const limit = 26_214_400;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ingest.mockResolvedValue({ flightId: "flight", status: "ready", deduped: false, warnings: [] });
  mocks.findFlight.mockResolvedValue(null);
});

it.each([limit, limit + 1])("checks the device upload boundary at %i bytes", async size => {
  const response = await deviceUpload(new Request("http://localhost/api/ingest", {
    method: "POST", headers: { authorization: "Bearer llk_test" }, body: new Uint8Array(size),
  }));
  expect(response.status).toBe(size === limit ? 200 : 413);
  expect(mocks.ingest).toHaveBeenCalledTimes(size === limit ? 1 : 0);
  expect(mocks.touchToken).toHaveBeenCalledTimes(size === limit ? 1 : 0);
  if (size === limit) expect(mocks.ingest.mock.calls[0][0].bytes.byteLength).toBe(size);
});

it.each([limit, limit + 1])("checks the manual upload boundary at %i bytes", async size => {
  const form = new FormData();
  form.set("files", new File([new Uint8Array(size)], "long-flight.igc"));
  const response = await webUpload(new Request("http://localhost/api/upload", { method: "POST", body: form }));
  const { results } = await response.json();
  expect(results[0]).toMatchObject(size === limit ? { flightId: "flight" } : { error: "File too large (max 25 MB)" });
  expect(mocks.ingest).toHaveBeenCalledTimes(size === limit ? 1 : 0);
  if (size === limit) expect(mocks.ingest.mock.calls[0][0].bytes.byteLength).toBe(size);
});

it.each([limit, limit + 1])("checks both attachment size guards at %i bytes", async size => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(size)], "long-flight.igc"));
  form.set("operation", "preview");
  const response = await attachUpload(new Request("http://localhost/api/flights/missing/attach-igc", {
    method: "POST", body: form,
  }), { params: Promise.resolve({ id: "missing" }) });
  // The exact-limit file passes the multipart and service guards and reaches ownership lookup.
  expect(response.status).toBe(size === limit ? 404 : 400);
  expect(await response.json()).toEqual({ error: size === limit ? "Flight not found." : "Choose a non-empty IGC file of 25 MB or less." });
  expect(mocks.findFlight).toHaveBeenCalledTimes(size === limit ? 1 : 0);
});
