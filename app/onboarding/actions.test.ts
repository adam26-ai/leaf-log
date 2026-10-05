import { beforeEach, expect, it, vi } from "vitest";
import { completeOnboarding } from "./actions";

const mocks = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { profile: { create: mocks.create } } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue("new-pilot");
  mocks.create.mockResolvedValue({});
});

it.each([
  [undefined, "friends"],
  ["private", "private"],
  ["public", "public"],
  ["invalid", "private"],
])("creates a profile with visibility %s resolved to %s", async (input, expected) => {
  const form = new FormData();
  form.set("handle", "pilot");
  form.set("display_name", "Pilot");
  if (input !== undefined) form.set("default_visibility", input);

  await expect(completeOnboarding({}, form)).rejects.toThrow("redirect:/logbook");
  expect(mocks.create).toHaveBeenCalledWith({
    data: { id: "new-pilot", handle: "pilot", displayName: "Pilot", defaultVisibility: expected },
  });
});
