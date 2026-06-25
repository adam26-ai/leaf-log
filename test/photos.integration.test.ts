// @vitest-environment node
//
// Photo privacy + processing invariants (app-layer, no RLS). Requires a local
// Postgres; skips when DATABASE_URL is unset.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import exifr from "exifr";
config({ path: ".env.local" });

const enabled = Boolean(process.env.DATABASE_URL);
const d = enabled ? describe : describe.skip;
const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;
const jpeg = readFileSync(join(__dirname, "photos/fixtures/exif-sample.jpg"));
const file = (name: string) => ({ filename: name, mime: "image/jpeg", bytes: jpeg });

d("photos privacy + processing", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let addPhotos: typeof import("@/lib/photos/add-photos").addPhotos;
  let repo: typeof import("@/lib/photos/repo");
  let ownerId = "";
  let otherId = "";
  let publicFlightId = "";
  let privateFlightId = "";
  let pubPhotoId = "";
  let privPhotoId = "";

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    ({ addPhotos } = await import("@/lib/photos/add-photos"));
    repo = await import("@/lib/photos/repo");

    const owner = await prisma.user.create({
      data: { email: `owner_${suffix}@test.local`, profile: { create: { handle: `owner${suffix}`, displayName: "Owner" } } },
    });
    ownerId = owner.id;
    const other = await prisma.user.create({
      data: { email: `other_${suffix}@test.local`, profile: { create: { handle: `other${suffix}`, displayName: "Other" } } },
    });
    otherId = other.id;

    publicFlightId = (
      await prisma.flight.create({
        data: { ownerId, visibility: "public", status: "ready", igcSha256: `pub${suffix}` },
      })
    ).id;
    privateFlightId = (
      await prisma.flight.create({
        data: { ownerId, visibility: "private", status: "ready", igcSha256: `priv${suffix}` },
      })
    ).id;

    const r1 = await addPhotos({ flightId: publicFlightId, ownerId, files: [file("a.jpg")] });
    pubPhotoId = r1.results[0].photoId as string;
    const r2 = await addPhotos({ flightId: privateFlightId, ownerId, files: [file("b.jpg")] });
    privPhotoId = r2.results[0].photoId as string;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });

  it("upload stores sanitized derivatives and a photo row", () => {
    expect(pubPhotoId).toBeTruthy();
    expect(privPhotoId).toBeTruthy();
  });

  it("non-owner/anon cannot list a private flight's photos", async () => {
    expect(await repo.listPhotosForViewer(privateFlightId, null)).toBeNull();
    expect(await repo.listPhotosForViewer(privateFlightId, otherId)).toBeNull();
    expect((await repo.listPhotosForViewer(publicFlightId, null))?.length).toBe(1);
    expect((await repo.listPhotosForViewer(privateFlightId, ownerId))?.length).toBe(1);
  });

  it("private photo bytes 404 for non-owner/anon; owner allowed", async () => {
    expect(await repo.getPhotoBytesForViewer(privateFlightId, privPhotoId, null, "thumb")).toBeNull();
    expect(await repo.getPhotoBytesForViewer(privateFlightId, privPhotoId, otherId, "display")).toBeNull();
    expect(await repo.getPhotoBytesForViewer(privateFlightId, privPhotoId, ownerId, "thumb")).not.toBeNull();
  });

  it("a photo cannot be fetched through the wrong flight", async () => {
    // private photo id requested via the public flight route → null
    expect(await repo.getPhotoBytesForViewer(publicFlightId, privPhotoId, ownerId, "thumb")).toBeNull();
  });

  it("served bytes contain no EXIF (date or GPS)", async () => {
    const bytes = await repo.getPhotoBytesForViewer(publicFlightId, pubPhotoId, null, "display");
    expect(bytes).not.toBeNull();
    const tags = await exifr.parse(bytes as Buffer).catch(() => null);
    expect(tags?.DateTimeOriginal).toBeUndefined();
    const gps = await exifr.gps(bytes as Buffer).catch(() => null);
    expect(gps?.latitude ?? null).toBeNull();
  });

  it("dedupes identical bytes within a flight", async () => {
    const r = await addPhotos({ flightId: publicFlightId, ownerId, files: [file("dup.jpg")] });
    expect(r.results[0].status).toBe("skipped_dupe");
  });

  it("rejects an upload from a non-owner", async () => {
    await expect(
      addPhotos({ flightId: privateFlightId, ownerId: otherId, files: [file("x.jpg")] }),
    ).rejects.toThrow();
  });

  it("rejects unsupported file types per-file", async () => {
    const r = await addPhotos({
      flightId: publicFlightId,
      ownerId,
      files: [{ filename: "notes.txt", mime: "text/plain", bytes: Buffer.from("nope") }],
    });
    expect(r.results[0].status).toBe("rejected");
  });
});
