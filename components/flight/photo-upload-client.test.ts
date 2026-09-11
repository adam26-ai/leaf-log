import { afterEach, expect, it, vi } from "vitest";
import { uploadPhotoFiles } from "./photo-upload-client";

afterEach(() => vi.unstubAllGlobals());

it("uploads every selected photo in its own request", async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const files = (init?.body as FormData).getAll("files") as File[];
    return {
      ok: true,
      json: async () => ({ results: [{ filename: files[0].name, status: "placed" }] }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetch);
  const files = Array.from({ length: 6 }, (_, index) => new File([`photo-${index}`], `photo-${index}.jpg`, { type: "image/jpeg" }));

  const results = await uploadPhotoFiles("flight-1", files);

  expect(results).toHaveLength(6);
  expect(fetch).toHaveBeenCalledTimes(6);
  for (const [, init] of fetch.mock.calls) {
    expect((init?.body as FormData).getAll("files")).toHaveLength(1);
  }
});
