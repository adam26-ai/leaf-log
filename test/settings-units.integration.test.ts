// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { METRIC_UNITS } from "@/lib/flights/units";

const session = vi.hoisted(() => ({ viewerId: null as string | null }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: async () => session.viewerId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { updateProfile } from "@/app/settings/actions";

const prisma = new PrismaClient();
const handle = `units${Date.now()}`;
const custom = { ...METRIC_UNITS, speed: "mph" as const, distance: "nautical-miles" as const };
let owner: string;
function form(mode = "custom", choices: unknown = custom) {
  const data = new FormData();
  Object.entries({ handle, display_name: "Units pilot", bio: "", default_visibility: "private", default_units: mode, custom_units: JSON.stringify(choices) }).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeAll(async () => {
  owner = (await prisma.user.create({ data: { profile: { create: { handle, displayName: "Units pilot" } } } })).id;
  session.viewerId = owner;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: owner } });
  await prisma.$disconnect();
});

it("saves custom units to the account and retains them alongside a preset", async () => {
  expect(await updateProfile({}, form())).toEqual({ ok: true });
  expect(await prisma.profile.findUnique({ where: { id: owner } })).toMatchObject({ defaultUnits: "custom", customUnits: custom });
  expect(await updateProfile({}, form("imperial"))).toEqual({ ok: true });
  expect(await prisma.profile.findUnique({ where: { id: owner } })).toMatchObject({ defaultUnits: "imperial", customUnits: custom });
});

it.each([null, { altitude: "ft" }, { ...custom, vario: "invalid" }])("rejects invalid custom settings without replacing saved preferences: %j", async invalid => {
  const before = await prisma.profile.findUnique({ where: { id: owner } });
  expect(await updateProfile({}, form("custom", invalid))).toHaveProperty("error");
  expect(await prisma.profile.findUnique({ where: { id: owner } })).toEqual(before);
});

it("requires a signed-in account", async () => {
  session.viewerId = null;
  expect(await updateProfile({}, form())).toEqual({ error: "Not signed in." });
  session.viewerId = owner;
});
