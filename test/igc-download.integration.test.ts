// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config({ path: ".env.local", quiet: true });

const session = vi.hoisted(() => ({ viewerId: null as string | null }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: async () => session.viewerId }));
import { GET } from "@/app/api/flights/[id]/igc/route";

const prisma = new PrismaClient();
const users: string[] = [];
const original = Buffer.concat([Buffer.from("AXXX\r\nHFDTE120626\r\nLOriginal recorder bytes "), Buffer.from([0xff]), Buffer.from("\r\nGSignature-kept\r\n")]);
let owner: string, friend: string, instructor: string, stranger: string;
let flightId: string, failedId: string, missingDataId: string;
const download = (id: string) => GET(new Request(`http://localhost/api/flights/${id}/igc`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  const prefix = `igcdl${Date.now()}`;
  for (const label of ["owner", "friend", "instructor", "stranger"]) {
    const user = await prisma.user.create({ data: { email: `${prefix}${label}@test.local`,
      profile: { create: { handle: `${prefix}${label}`, displayName: label } } } });
    users.push(user.id);
  }
  [owner, friend, instructor, stranger] = users;
  await prisma.friendship.create({ data: { requesterId: owner, addresseeId: friend, status: "accepted" } });
  flightId = (await prisma.flight.create({ data: { ownerId: owner, instructorId: instructor,
    status: "ready", xcStatus: "failed", igcSha256: `${prefix}-ready`, visibility: "private",
    takeoffAt: new Date("2026-06-12T00:30:00Z"), localUtcOffsetMinutes: -420,
    data: { create: { rawIgc: original } } } })).id;
  failedId = (await prisma.flight.create({ data: { ownerId: owner, status: "failed", igcSha256: `${prefix}-failed`,
    flightDate: new Date("2026-06-13T00:00:00Z"), localUtcOffsetMinutes: -420,
    data: { create: { rawIgc: original } } } })).id;
  missingDataId = (await prisma.flight.create({ data: { ownerId: owner, status: "ready", igcSha256: `${prefix}-missing` } })).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it.each(["private", "friends", "public"])("downloads the owner's exact original bytes for a %s flight, even when XC failed", async visibility => {
  session.viewerId = owner;
  await prisma.flight.update({ where: { id: flightId }, data: { visibility } });
  const response = await download(flightId);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="flight-2026-06-11-${flightId}.igc"`);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("content-length")).toBe(String(original.length));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

it("downloads an unreadable flight and keeps a date-only IGC date unchanged", async () => {
  session.viewerId = owner;
  const response = await download(failedId);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="flight-2026-06-13-${failedId}.igc"`);
});

it.each(["private", "friends", "public"])("does not expose a %s original to anonymous viewers, friends, instructors, or strangers", async visibility => {
  await prisma.flight.update({ where: { id: flightId }, data: { visibility } });
  for (const viewer of [null, friend, instructor, stranger]) {
    session.viewerId = viewer;
    const response = await download(flightId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

it("handles missing flights and missing original data", async () => {
  session.viewerId = owner;
  for (const id of [missingDataId, "does-not-exist"]) {
    const response = await download(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  }
});
