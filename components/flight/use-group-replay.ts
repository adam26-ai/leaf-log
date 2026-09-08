"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayResponse } from "@/lib/igc/replay";
import { flightForPilot, groupTimeBounds, type CompanionFlight, type CompanionManifest, type ReplayPilot } from "@/lib/flights/group-replay";
import type { FlightPhoto } from "./photos";

export interface LoadedReplayFlight extends CompanionFlight {
  replay: ReplayResponse;
  photos: FlightPhoto[];
}
type Payload = { replay: ReplayResponse; photos: FlightPhoto[] };

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export function useGroupReplay(primary: CompanionFlight, viewerId: string | null, timeMs: number) {
  const primaryId = primary.id;
  const [manifest, setManifest] = useState<CompanionManifest>({ flights: [], nextCursor: null });
  const [payloads, setPayloads] = useState<Record<string, Payload>>({});
  const [failures, setFailures] = useState<string[]>([]);
  const [photoFailures, setPhotoFailures] = useState<string[]>([]);
  const [discoveryError, setDiscoveryError] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [selection, setSelection] = useState({ pilotId: primary.owner.id, flightId: primaryId, automatic: false });
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [retryVersion, setRetryVersion] = useState(0);
  const discoveryAbort = useRef<AbortController | null>(null);
  const pageCount = useRef(1);

  const discover = useCallback(async (more = false) => {
    if (!viewerId) return;
    discoveryAbort.current?.abort();
    const controller = new AbortController();
    discoveryAbort.current = controller;
    setDiscovering(true);
    setDiscoveryError(false);
    try {
      let cursor = more ? manifest.nextCursor : null;
      const gathered: CompanionFlight[] = more ? [...manifest.flights] : [];
      const pages = more ? 1 : pageCount.current;
      for (let page = 0; page < pages; page++) {
        const result = await json<CompanionManifest>(`/api/flights/${primaryId}/companions${cursor ? `?cursor=${cursor}` : ""}`, controller.signal);
        gathered.push(...result.flights);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      if (more) pageCount.current++;
      setManifest({ flights: [...new Map(gathered.map((f) => [f.id, f])).values()], nextCursor: cursor });
      // The manifest reauthorizes companions. Keep valid tracks mounted so a
      // refresh cannot momentarily switch the selected pilot or reset the camera.
      if (!more) {
        const allowed = new Set([primaryId, ...gathered.map((f) => f.id)]);
        setPayloads((old) => Object.fromEntries(Object.entries(old).filter(([id]) => allowed.has(id))));
        setFailures([]);
        setRetryVersion((v) => v + 1);
      }
    } catch (error) {
      if (!controller.signal.aborted) { setDiscoveryError(true); if (error instanceof Error && error.message === "404") setManifest({ flights: [], nextCursor: null }); }
    } finally { if (!controller.signal.aborted) setDiscovering(false); }
  }, [viewerId, primaryId, manifest]);

  useEffect(() => {
    const timer = window.setTimeout(() => void discover(), 0);
    return () => { window.clearTimeout(timer); discoveryAbort.current?.abort(); };
    // Initial discovery is independent of subsequent explicit refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId, viewerId]);

  const candidates = useMemo(() => [primary, ...manifest.flights.filter((f) => f.id !== primaryId)], [primary, primaryId, manifest]);
  const pilots = useMemo(() => {
    const owners = [...new Map(candidates.map((f) => [f.owner.id, f.owner])).values()];
    return owners.sort((a, b) => Number(b.id === primary.owner.id) - Number(a.id === primary.owner.id)
      || Number(b.id === viewerId) - Number(a.id === viewerId));
  }, [candidates, primary.owner.id, viewerId]);
  const isVisible = useCallback((pilotId: string) => visibility[pilotId] ?? pilots.findIndex((p) => p.id === pilotId) < 6, [visibility, pilots]);
  const wantedIds = candidates.filter((f) => isVisible(f.owner.id) || f.id === primaryId).map((f) => f.id).join(",");

  useEffect(() => {
    const controller = new AbortController();
    const queue = wantedIds.split(",").filter((id) => id && !payloads[id] && !failures.includes(id));
    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        try {
          const replay = await json<ReplayResponse>(`/api/flights/${id}/replay`, controller.signal);
          if (replay.samples.length < 2) throw new Error("No track");
          let photos: FlightPhoto[] = [];
          try { photos = (await json<{ photos: FlightPhoto[] }>(`/api/flights/${id}/photos`, controller.signal)).photos; }
          catch { if (!controller.signal.aborted) setPhotoFailures((old) => [...new Set([...old, id])]); }
          if (!controller.signal.aborted) setPayloads((old) => ({ ...old, [id]: { replay, photos } }));
        } catch {
          if (!controller.signal.aborted) setFailures((old) => [...new Set([...old, id])]);
        }
      }
    }
    void Promise.all([worker(), worker(), worker()]);
    return () => controller.abort();
    // The queue owns its in-flight results; each completion must not restart siblings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedIds, retryVersion]);

  const flights = useMemo<LoadedReplayFlight[]>(() => candidates.flatMap((f) => {
    const payload = payloads[f.id];
    return payload ? [{ ...f, ...payload, takeoffMs: payload.replay.takeoffMs, landingMs: payload.replay.takeoffMs + payload.replay.durationS * 1000 }] : [];
  }), [candidates, payloads]);
  const visibleFlights = useMemo(() => flights.filter((f) => isVisible(f.owner.id)), [flights, isVisible]);
  const pilotFlights = visibleFlights.filter((f) => f.owner.id === selection.pilotId);
  const selected = pilotFlights.length
    ? (selection.automatic ? flightForPilot(pilotFlights, timeMs, selection.flightId) : pilotFlights.find((f) => f.id === selection.flightId) ?? flightForPilot(pilotFlights, timeMs))
    : visibleFlights.find((f) => f.id === primaryId) ?? visibleFlights[0];

  const select = useCallback((pilot: ReplayPilot, flightId?: string) => {
    setVisibility((old) => ({ ...old, [pilot.id]: true }));
    setSelection({ pilotId: pilot.id, flightId: flightId === "auto" ? "" : flightId ?? (pilot.id === primary.owner.id ? primaryId : ""), automatic: flightId === "auto" || (!flightId && pilot.id !== primary.owner.id) });
  }, [primary.owner.id, primaryId]);
  const toggle = useCallback((pilotId: string) => {
    const shown = isVisible(pilotId);
    if (shown && !flights.some((f) => f.owner.id !== pilotId && isVisible(f.owner.id))) return;
    setVisibility((old) => ({ ...old, [pilotId]: !shown }));
    if (shown && selected?.owner.id === pilotId) {
      const fallback = pilots.find((p) => p.id !== pilotId && isVisible(p.id) && flights.some((f) => f.owner.id === p.id));
      if (fallback) select(fallback);
    }
  }, [isVisible, pilots, selected, select, flights]);
  const retry = useCallback(() => {
    setPayloads((old) => Object.fromEntries(Object.entries(old).filter(([id]) => !photoFailures.includes(id))));
    setFailures([]);
    setPhotoFailures([]);
    setRetryVersion((v) => v + 1);
  }, [photoFailures]);
  const reloadPhotos = useCallback(async () => {
    try {
      const { photos } = await json<{ photos: FlightPhoto[] }>(`/api/flights/${primaryId}/photos`);
      setPayloads((old) => old[primaryId] ? { ...old, [primaryId]: { ...old[primaryId], photos } } : old);
    } catch { setPhotoFailures((old) => [...new Set([...old, primaryId])]); }
  }, [primaryId]);
  const timelineFlights = candidates.map((f) => flights.find((loaded) => loaded.id === f.id) ?? f);
  const bounds = groupTimeBounds(timelineFlights);
  return { flights, visibleFlights, selected, pilots, candidates, isVisible, select, toggle, failures, photoFailures,
    primaryReplay: payloads[primaryId]?.replay ?? null, bounds, discover, discovering, discoveryError,
    nextCursor: manifest.nextCursor, retry, reloadPhotos };
}
