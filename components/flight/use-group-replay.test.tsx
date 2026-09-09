import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGroupReplay } from "./use-group-replay";
import type { CompanionFlight } from "@/lib/flights/group-replay";
import type { ReplayResponse } from "@/lib/igc/replay";

const primary: CompanionFlight = { id: "primary", owner: { id: "self", handle: "self", displayName: "Self", avatarUpdatedAt: null }, takeoffMs: 100_000, landingMs: 200_000, xcScore: null };
const friend: CompanionFlight = { ...primary, id: "companion", owner: { ...primary.owner, id: "friend", handle: "friend", displayName: "Friend" }, takeoffMs: 90_000, landingMs: 210_000 };
function replay(flight: CompanionFlight): ReplayResponse {
  const durationS = (flight.landingMs - flight.takeoffMs) / 1000;
  return { takeoffMs: flight.takeoffMs, durationS, offsetMin: 0, altSource: "gps", bounds: [0, 0, 1, 1], samples: [[0, 0, 100, 0], [1, 1, 200, durationS]], vario: [1, 1] };
}
function server() {
  const state = { authorized: true, failFriend: false };
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/companions")) return { ok: true, json: async () => ({ flights: state.authorized ? [friend] : [], nextCursor: null }) };
    const flight = url.includes("/companion/") ? friend : primary;
    if (state.failFriend && flight === friend) return { ok: false, status: 500 };
    return { ok: true, json: async () => url.endsWith("/photos") ? { photos: [] } : replay(flight) };
  });
  vi.stubGlobal("fetch", fetch);
  return { state, fetch };
}
afterEach(() => vi.unstubAllGlobals());

describe("group replay controller", () => {
  it("keeps time bounds and cached tracks when selecting, hiding, and revealing pilots", async () => {
    const { fetch } = server();
    const { result } = renderHook(() => useGroupReplay(primary, "self", 150_000));
    await waitFor(() => expect(result.current.visibleFlights).toHaveLength(2));
    const bounds = result.current.bounds;
    const count = fetch.mock.calls.length;
    act(() => result.current.select(friend.owner));
    expect(result.current.selected?.id).toBe(friend.id);
    act(() => result.current.toggle(friend.owner.id));
    expect(result.current.selected?.id).toBe(primary.id);
    expect(result.current.visibleFlights).toHaveLength(1);
    expect(result.current.bounds).toEqual(bounds);
    act(() => result.current.toggle(primary.owner.id));
    expect(result.current.visibleFlights).toHaveLength(1);
    act(() => result.current.select(friend.owner));
    expect(result.current.visibleFlights).toHaveLength(2);
    expect(result.current.selected?.id).toBe(friend.id);
    expect(fetch.mock.calls.length).toBe(count);
  });

  it("refreshes permissions without discarding a still-authorized selected replay", async () => {
    const { state } = server();
    const { result } = renderHook(() => useGroupReplay(primary, "self", 150_000));
    await waitFor(() => expect(result.current.visibleFlights).toHaveLength(2));
    act(() => result.current.select(friend.owner));
    const originalReplay = result.current.selected?.replay;
    await act(async () => { await result.current.discover(); });
    expect(result.current.selected?.replay).toBe(originalReplay);
    state.authorized = false;
    await act(async () => { await result.current.discover(); });
    expect(result.current.pilots).toHaveLength(1);
    expect(result.current.selected?.id).toBe(primary.id);
  });

  it("keeps the primary usable while a companion fails and retries only missing data", async () => {
    const { state } = server();
    state.failFriend = true;
    const { result } = renderHook(() => useGroupReplay(primary, "self", 150_000));
    await waitFor(() => expect(result.current.failures).toContain(friend.id));
    const originalReplay = result.current.primaryReplay;
    expect(result.current.selected?.id).toBe(primary.id);
    state.failFriend = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.visibleFlights).toHaveLength(2));
    expect(result.current.primaryReplay).toBe(originalReplay);
  });

  it("keeps anonymous replay solo", async () => {
    const { fetch } = server();
    const { result } = renderHook(() => useGroupReplay(primary, null, 150_000));
    await waitFor(() => expect(result.current.primaryReplay).not.toBeNull());
    expect(result.current.pilots).toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/companions"))).toBe(false);
  });
});
