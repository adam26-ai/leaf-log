import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient, type Flight } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { groupReplayFixtures } from "../test/igc/group-fixtures";
import { ingestFlight } from "../lib/ingest/ingest-flight";
import { replayArtifactForFlight } from "../lib/flights/replay-repo";
import { replayPositionAt } from "../lib/flights/group-replay";
import { listReplayCompanions } from "../lib/flights/repo";

const prisma = new PrismaClient();
async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/leaf_log_dev") throw new Error("Replay demo seeding is restricted to the local leaf_log_dev database.");
  const fixtures = groupReplayFixtures();
  mkdirSync("test-results/replay-demo", { recursive: true });
  const pilots: string[] = [];
  const flights: Flight[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const role = i ? "friend" : "self";
    const name = i ? "Friend (demo)" : "Self (demo)";
    const email = `replay-${role}@test.local`;
    writeFileSync(`test-results/replay-demo/${role}.igc`, fixtures[i]);
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, profile: { create: { handle: `replay${role}`, displayName: name, defaultVisibility: "friends" } } } });
    pilots.push(user.id);
    const result = await ingestFlight({ ownerId: user.id, bytes: fixtures[i] });
    const flight = await prisma.flight.update({ where: { id: result.flightId }, data: { visibility: "friends", xcStatus: "unscored", xcQueuedAt: null } });
    flights.push(flight);
    const artifact = await replayArtifactForFlight(flight);
    if (!artifact) throw new Error("Fixture could not be parsed");
    const t = Math.round(artifact.replay.durationS / 2);
    const position = replayPositionAt(artifact.replay, t);
    const svg = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="360" fill="${i ? "#0099ff" : "#d8ff00"}"/><text x="320" y="180" text-anchor="middle" font-family="Arial" font-size="32" fill="#141414">${name} · Replay test photo</text></svg>`;
    const display = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const thumb = await sharp(display).resize(160, 90).jpeg().toBuffer();
    const sha256 = createHash("sha256").update(display).digest("hex");
    await prisma.photo.upsert({ where: { flightId_sha256: { flightId: flight.id, sha256 } }, update: {}, create: {
      flightId: flight.id, sha256, originalFilename: `${role}-demo.jpg`, displayWidth: 640, displayHeight: 360, displayBytes: display.length,
      thumbWidth: 160, thumbHeight: 90, thumbBytes: thumb.length, tSec: t, takenAt: new Date(artifact.replay.takeoffMs + t * 1000),
      lat: position[1], lon: position[0], altM: Math.round(position[2]), placementSource: "interpolated_time", data: { create: { display: new Uint8Array(display), thumb: new Uint8Array(thumb) } },
    } });
  }
  await prisma.friendship.upsert({ where: { requesterId_addresseeId: { requesterId: pilots[0], addresseeId: pilots[1] } },
    update: { status: "accepted" }, create: { requesterId: pilots[0], addresseeId: pilots[1], status: "accepted", respondedAt: new Date() } });
  console.log(JSON.stringify({ signIn: "replay-self@test.local", flights: flights.map((f) => ({ id: f.id, url: `http://localhost:3000/flights/${f.id}`, takeoff: f.takeoffAt, landing: f.landingAt })) }, null, 2));
  if (process.argv.includes("--benchmark")) {
    const times = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const manifest = await listReplayCompanions(flights[0].id, pilots[0]);
      times.push(Math.round(performance.now() - start));
      if (!manifest?.flights.some((f) => f.id === flights[1].id)) throw new Error("Demo companion was not discovered");
    }
    console.log("Cached-artifact discovery, ms:", times);
    for (const flight of flights) {
      const artifact = (await replayArtifactForFlight(flight))!;
      console.log(flight.id, "replay samples:", artifact.replay.samples.length, "uncompressed replay bytes:", Buffer.byteLength(JSON.stringify(artifact.replay)));
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
