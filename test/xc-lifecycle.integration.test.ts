// @vitest-environment node
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { beforeAll, afterAll, expect, it } from "vitest";
import { makeRealisticFlight } from "./igc/make-igc";
import { analysisState } from "@/lib/flights/analysis-state";

let ownerId: string | undefined;
let prisma: typeof import("@/lib/prisma").prisma;
let processNextXcJob: typeof import("@/lib/igc/xc-queue").processNextXcJob;
beforeAll(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({ processNextXcJob } = await import("@/lib/igc/xc-queue"));
});
afterAll(async () => {
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});
it("recovers an interrupted legacy repair and persists usable artifacts and XC coverage", async () => {
  const handle = `xc${Date.now().toString(36)}`;
  const user = await prisma.user.create({ data: { email: `${handle}@test.local`,
    profile: { create: { handle, displayName: "XC lifecycle test" } } } });
  ownerId = user.id;
  const flight = await prisma.flight.create({ data: {
    ownerId, igcSha256: handle, status: "ready", metricsVersion: 0,
    xcStatus: "repairing", xcStartedAt: new Date(0), xcQueuedAt: new Date(0),
    glider: "Pilot's edited wing", notes: "Keep this note",
    data: { create: { rawIgc: Buffer.from(makeRealisticFlight().igc) } },
  } });
  // Concurrent consumers must not both claim this queued row.
  const worked = await Promise.all([processNextXcJob(), processNextXcJob()]);
  expect(worked.filter(Boolean)).toHaveLength(1);
  const saved = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id }, include: { data: true } });
  expect(saved.metricsVersion).toBe(1);
  expect(saved.launchAltM).not.toBeNull();
  expect(saved.durationS).toBeGreaterThan(0);
  expect(saved.glider).toBe("Pilot's edited wing"); expect(saved.notes).toBe("Keep this note");
  expect(saved.data?.track).toMatchObject({ v: 1 });
  expect(saved.data?.replay).not.toBeNull();
  expect(saved.xcScore).toMatchObject({ scoringVersion: 2, completedCategories: expect.arrayContaining(["open"]) });
  expect(saved.xcStartedAt).toBeNull();
  expect(["Best found", "Calculated", "Complete XC", "No eligible route"]).toContain(analysisState(saved).label);
}, 30000);
