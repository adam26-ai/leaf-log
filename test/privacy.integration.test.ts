// @vitest-environment node
//
// Exercises the privacy invariant through the REAL Supabase client paths
// (PostgREST + RLS), not just raw SQL. Requires a running local Supabase; skips
// cleanly when the env isn't configured (e.g. plain CI without a stack).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  // Node 21+: load local dev env if present.
  (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    ".env.local",
  );
} catch {
  /* no env file — test will skip below */
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SERVICE);
const d = enabled ? describe : describe.skip;

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;
const ownerEmail = `owner_${suffix}@test.local`;
const otherEmail = `other_${suffix}@test.local`;
const PASSWORD = "test-password-123456";

d("privacy invariant (RLS via client)", () => {
  let admin: SupabaseClient;
  let ownerId = "";
  let otherId = "";
  let publicFlightId = "";
  let privateFlightId = "";

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const o = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    ownerId = o.data.user!.id;
    const b = await admin.auth.admin.createUser({
      email: otherEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    otherId = b.data.user!.id;

    await admin.from("profiles").insert([
      { id: ownerId, handle: `owner${suffix}`, display_name: "Owner" },
      { id: otherId, handle: `other${suffix}`, display_name: "Other" },
    ]);

    const ins = await admin
      .from("flights")
      .insert([
        { owner_id: ownerId, visibility: "public", igc_sha256: `pub${suffix}`, status: "ready", duration_s: 100 },
        { owner_id: ownerId, visibility: "private", igc_sha256: `priv${suffix}`, status: "ready", duration_s: 200 },
      ])
      .select("id, visibility");
    publicFlightId = ins.data!.find((f) => f.visibility === "public")!.id;
    privateFlightId = ins.data!.find((f) => f.visibility === "private")!.id;

    await admin.from("flight_assets").insert({
      flight_id: privateFlightId,
      kind: "raw_igc",
      bucket: "igc",
      object_key: `${ownerId}/x.igc`,
      content_type: "text/plain",
      byte_size: 1,
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("flights").delete().eq("owner_id", ownerId);
    await admin.from("profiles").delete().in("id", [ownerId, otherId]);
    await admin.auth.admin.deleteUser(ownerId);
    await admin.auth.admin.deleteUser(otherId);
  });

  it("anonymous visitors see only public flights, never assets", async () => {
    const anon = createClient(URL!, ANON!);
    const flights = await anon
      .from("flights")
      .select("id, visibility")
      .eq("owner_id", ownerId);
    expect(flights.data?.map((f) => f.id)).toEqual([publicFlightId]);

    const assets = await anon.from("flight_assets").select("id");
    expect(assets.data ?? []).toHaveLength(0);
  });

  it("a private flight is invisible to an authenticated non-owner", async () => {
    const other = createClient(URL!, ANON!);
    await other.auth.signInWithPassword({ email: otherEmail, password: PASSWORD });

    const visible = await other
      .from("flights")
      .select("id")
      .eq("id", privateFlightId)
      .maybeSingle();
    expect(visible.data).toBeNull();

    // ...and they cannot publish someone else's private flight.
    await other.from("flights").update({ visibility: "public" }).eq("id", privateFlightId);
    const stillPrivate = await admin
      .from("flights")
      .select("visibility")
      .eq("id", privateFlightId)
      .single();
    expect(stillPrivate.data?.visibility).toBe("private");
  });

  it("the owner sees both of their flights", async () => {
    const owner = createClient(URL!, ANON!);
    await owner.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
    const flights = await owner.from("flights").select("id").eq("owner_id", ownerId);
    expect(flights.data).toHaveLength(2);
  });
});
