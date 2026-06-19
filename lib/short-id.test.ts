import { describe, it, expect } from "vitest";
import {
  generateShortId,
  isP2002OnId,
  createWithShortIdRetry,
  SHORT_ID_LENGTH,
} from "./short-id";

describe("generateShortId", () => {
  it("is 4 chars over [a-z0-9]", () => {
    for (let i = 0; i < 500; i++) {
      const id = generateShortId();
      expect(id).toHaveLength(SHORT_ID_LENGTH);
      expect(id).toMatch(/^[a-z0-9]{4}$/);
    }
  });

  it("is overwhelmingly unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateShortId());
    // 1000 draws from 1.68M space — a handful of collisions at most.
    expect(seen.size).toBeGreaterThan(995);
  });
});

describe("isP2002OnId", () => {
  it("detects a PK/id unique violation", () => {
    expect(isP2002OnId({ code: "P2002", meta: { target: ["id"] } })).toBe(true);
    expect(isP2002OnId({ code: "P2002", meta: { target: "Flight_pkey" } })).toBe(true);
  });
  it("ignores non-P2002 errors", () => {
    expect(isP2002OnId({ code: "P2003" })).toBe(false);
    expect(isP2002OnId(new Error("nope"))).toBe(false);
  });
});

describe("createWithShortIdRetry", () => {
  it("injects a 4-char id when none is supplied", async () => {
    let received = "";
    const args: { data: { id?: string } } = { data: {} };
    const r = await createWithShortIdRetry(args, async (a) => {
      received = a.data.id!;
      return "ok";
    });
    expect(r).toBe("ok");
    expect(received).toMatch(/^[a-z0-9]{4}$/);
  });

  it("respects a caller-supplied id (no generation, no retry)", async () => {
    let calls = 0;
    const r = await createWithShortIdRetry({ data: { id: "mine" } }, async (args) => {
      calls++;
      expect(args.data.id).toBe("mine");
      return "ok";
    });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on an id collision then succeeds", async () => {
    const ids: string[] = [];
    let calls = 0;
    const args: { data: { id?: string } } = { data: {} };
    const r = await createWithShortIdRetry(args, async (a) => {
      calls++;
      ids.push(a.data.id!);
      if (calls === 1) throw { code: "P2002", meta: { target: ["id"] } };
      return "ok";
    });
    expect(r).toBe("ok");
    expect(calls).toBe(2);
    expect(ids[0]).not.toBe(ids[1]); // regenerated on retry
  });

  it("rethrows a non-id error immediately", async () => {
    await expect(
      createWithShortIdRetry({ data: {} }, async () => {
        throw { code: "P2002", meta: { target: ["ownerId", "igcSha256"] } };
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
