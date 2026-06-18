import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildTrackArtifact } from "@/lib/igc/track-artifact";
import { sha256Hex } from "./dedupe";

export const PARSER_VERSION = "1";

const IGC_BUCKET = "igc";
const TRACK_BUCKET = "tracks";

export type IngestSource = "web_upload" | "device_push";

export interface IngestInput {
  ownerId: string;
  bytes: Uint8Array;
  source?: IngestSource;
  filename?: string;
}

export interface IngestResult {
  flightId: string;
  status: "ready" | "failed";
  deduped: boolean;
  warnings: string[];
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The single, source-agnostic ingestion path. Web upload is its first caller; a
 * future Leaf device-push API is its second. Stores the raw IGC durably, parses +
 * derives, builds the render artifact, and persists the flight — cleaning up
 * orphaned storage objects if persistence fails. Never throws on malformed IGC:
 * an unparseable file becomes a `failed` flight with the raw bytes preserved.
 */
export async function ingestFlight(input: IngestInput): Promise<IngestResult> {
  const { ownerId, bytes, source = "web_upload" } = input;
  const supabase = createAdminClient();

  const hash = sha256Hex(bytes);

  // Dedupe: same pilot + same exact bytes → no-op.
  const { data: existing } = await supabase
    .from("flights")
    .select("id, status")
    .eq("owner_id", ownerId)
    .eq("igc_sha256", hash)
    .maybeSingle();
  if (existing) {
    return {
      flightId: existing.id,
      status: existing.status === "ready" ? "ready" : "failed",
      deduped: true,
      warnings: [],
    };
  }

  const flightId = randomUUID();
  const igcKey = `${ownerId}/${hash}.igc`;
  const trackKey = `${ownerId}/${flightId}.json`;
  const uploaded: { bucket: string; key: string }[] = [];

  try {
    // 1. Store raw IGC first (durable source of truth; enables reprocessing).
    const rawUp = await supabase.storage
      .from(IGC_BUCKET)
      .upload(igcKey, Buffer.from(bytes), {
        contentType: "application/octet-stream",
        upsert: true,
      });
    if (rawUp.error) throw rawUp.error;
    uploaded.push({ bucket: IGC_BUCKET, key: igcKey });

    // 2. Parse + 3. derive (pure).
    const parsed = parseIgc(bytes);
    const metrics = deriveMetrics(parsed);

    const assetRows: {
      flight_id: string;
      kind: "raw_igc" | "derived_track";
      bucket: string;
      object_key: string;
      content_type: string;
      byte_size: number;
    }[] = [
      {
        flight_id: flightId,
        kind: "raw_igc",
        bucket: IGC_BUCKET,
        object_key: igcKey,
        content_type: "application/octet-stream",
        byte_size: bytes.byteLength,
      },
    ];

    // 4. Build + store the render artifact when we have metrics.
    if (metrics) {
      const artifact = buildTrackArtifact(parsed.fixes, metrics);
      const json = Buffer.from(JSON.stringify(artifact));
      const trackUp = await supabase.storage
        .from(TRACK_BUCKET)
        .upload(trackKey, json, {
          contentType: "application/json",
          upsert: true,
        });
      if (trackUp.error) throw trackUp.error;
      uploaded.push({ bucket: TRACK_BUCKET, key: trackKey });
      assetRows.push({
        flight_id: flightId,
        kind: "derived_track",
        bucket: TRACK_BUCKET,
        object_key: trackKey,
        content_type: "application/json",
        byte_size: json.byteLength,
      });
    }

    // 5. Persist the flight row.
    const status: "ready" | "failed" = metrics ? "ready" : "failed";
    const flightDateMs =
      parsed.headers.dateMs ?? metrics?.takeoffAtMs ?? Date.parse("1970-01-01");

    const { error: flightErr } = await supabase.from("flights").insert({
      id: flightId,
      owner_id: ownerId,
      source,
      status,
      visibility: "private",
      igc_sha256: hash,
      parser_version: PARSER_VERSION,
      parse_warnings: parsed.warnings,
      failure_reason: metrics ? null : "No usable GPS fixes in file",
      flight_date: isoDate(flightDateMs),
      glider: parsed.headers.glider,
      recorder: parsed.headers.recorder,
      takeoff_at: metrics ? new Date(metrics.takeoffAtMs).toISOString() : null,
      landing_at: metrics ? new Date(metrics.landingAtMs).toISOString() : null,
      duration_s: metrics?.durationS ?? null,
      max_alt_m: metrics?.maxAltM ?? null,
      alt_gain_m: metrics?.altGainM ?? null,
      max_climb_ms: metrics?.maxClimbMs ?? null,
      max_sink_ms: metrics?.maxSinkMs ?? null,
      alt_source: metrics?.altSource ?? null,
      track_dist_m: metrics?.trackDistM ?? null,
      straight_dist_m: metrics?.straightDistM ?? null,
      takeoff_lat: metrics?.takeoff.lat ?? null,
      takeoff_lon: metrics?.takeoff.lon ?? null,
      landing_lat: metrics?.landing.lat ?? null,
      landing_lon: metrics?.landing.lon ?? null,
      bounds: metrics?.bounds ?? null,
      local_tz: metrics?.localTz ?? null,
      local_utc_offset_minutes: metrics?.localUtcOffsetMinutes ?? null,
    });
    if (flightErr) throw flightErr;

    const { error: assetErr } = await supabase
      .from("flight_assets")
      .insert(assetRows);
    if (assetErr) throw assetErr;

    return { flightId, status, deduped: false, warnings: parsed.warnings };
  } catch (err) {
    // Best-effort cleanup so a failed ingest leaves no orphaned objects/rows.
    await supabase.from("flights").delete().eq("id", flightId);
    for (const o of uploaded) {
      await supabase.storage.from(o.bucket).remove([o.key]);
    }
    throw err instanceof Error ? err : new Error("Ingestion failed");
  }
}
