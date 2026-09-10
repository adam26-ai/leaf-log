// @vitest-environment node
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { afterAll, beforeAll, expect, it } from "vitest";
let prisma: typeof import("@/lib/prisma").prisma;
let wings: typeof import("@/lib/flights/wings");
const owners: string[] = [];
beforeAll(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  wings = await import("@/lib/flights/wings");
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: owners } } });
  await prisma.$disconnect();
});
it("renames and merges exact owner-scoped wings, preserves flight data and rejects stale counts", async () => {
  for (let i = 0; i < 2; i++) {
    const handle = `wg${Date.now().toString(36)}${i}`;
    const owner = await prisma.user.create({ data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: "Wing test" } } } });
    owners.push(owner.id);
  }
  const create = (ownerId: string, glider: string | null, suffix: string) => prisma.flight.create({ data: {
    ownerId, glider, igcSha256: suffix, status: "ready", metricsVersion: METRICS_VERSION, durationS: 120,
    notes: "Keep notes", visibility: "private", xcStatus: "ready", xcScore: { preserve: true },
  } });
  const a = await create(owners[0], "Ozone Rush4", "a");
  const b = await create(owners[0], "Rush 4", "b");
  await create(owners[0], "Ozone Rush 4", "target");
  const other = await create(owners[1], "Rush 4", "other");
  const unlisted = await create(owners[0], null, "null");
  expect(await wings.renameOwnWings(owners[0], { sources: [{ name: "Ozone Rush4", count: 1 }, { name: "Rush 4", count: 1 }], target: "Ozone Rush 4" })).toBe(2);
  expect(await wings.listOwnWings(owners[0])).toEqual(expect.arrayContaining([{ name: "Ozone Rush 4", count: 3 }, { name: null, count: 1 }]));
  expect(await prisma.flight.findUnique({ where: { id: other.id } })).toMatchObject({ glider: "Rush 4" });
  expect(await prisma.flight.findUnique({ where: { id: a.id } })).toMatchObject({ glider: "Ozone Rush 4", durationS: 120, notes: "Keep notes", visibility: "private", xcScore: { preserve: true } });
  expect(await prisma.flight.findUnique({ where: { id: b.id } })).toMatchObject({ glider: "Ozone Rush 4" });
  await expect(wings.renameOwnWings(owners[0], { sources: [{ name: "Ozone Rush 4", count: 2 }, { name: null, count: 1 }], target: "Stale change" })).rejects.toBeInstanceOf(wings.WingListChanged);
  expect(await prisma.flight.findUnique({ where: { id: unlisted.id } })).toMatchObject({ glider: null });
  expect(await wings.renameOwnWings(owners[0], { sources: [{ name: null, count: 1 }], target: "Named wing" })).toBe(1);
  await expect(wings.renameOwnWings(owners[0], { sources: [{ name: "Rush 4", count: 1 }], target: "Other owner's wing" })).rejects.toBeInstanceOf(wings.WingListChanged);
}, 20000);
