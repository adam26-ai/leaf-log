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
  const [selection, setSelection] = useState({ pilotId: primary.owner.id, flightId: primaryId });
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [retryVersion, setRetryVersion] = useState(0);
  const discoveryAbort = useRef<AbortController | null>(null);
  const photosLoaded = useRef(new Set<string>());
  const photoVersions = useRef(new Map<string, number>());

  const discover = useCallback(async (more = false, expandDay = manifest.dayExpanded ?? false) => {
    if (!viewerId) return;
    discoveryAbort.current?.abort();
    const controller = new AbortController();
    discoveryAbort.current = controller;
    setDiscovering(true);
    setDiscoveryError(false);
    try {
      let cursor = more ? manifest.nextCursor : null;
      const gathered: CompanionFlight[] = more ? [...manifest.flights] : [];
      let dayExpanded = false;
      do {
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        if (expandDay) params.set("day", "1");
        const result = await json<CompanionManifest>(`/api/flights/${primaryId}/companions${params.size ? `?${params}` : ""}`, controller.signal);
        gathered.push(...result.flights);
        dayExpanded = result.dayExpanded ?? false;
        cursor = result.nextCursor;
      } while (cursor && !controller.signal.aborted);
      if (controller.signal.aborted) return;
      setManifest({ flights: [...new Map(gathered.map((f) => [f.id, f])).values()], nextCursor: cursor, dayExpanded });
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
  const isVisible = useCallback((pilotId: string) => visibility[pilotId] ?? (manifest.dayExpanded || pilots.findIndex((p) => p.id === pilotId) < 6), [visibility, pilots, manifest.dayExpanded]);
  const wantedIds = candidates.filter((f) => isVisible(f.owner.id) || f.id === primaryId).map((f) => f.id).join(",");

  useEffect(() => {
    const controller = new AbortController();
    const queue = wantedIds.split(",").filter((id) => id && !payloads[id] && !failures.includes(id));
    const photoQueue = wantedIds.split(",").filter((id) => id && payloads[id] && !photosLoaded.current.has(id));
    let activePhotos = 0;
    function loadPhotos() {
      while (activePhotos < 3 && photoQueue.length && !controller.signal.aborted) {
        const id = photoQueue.shift()!;
        const version = (photoVersions.current.get(id) ?? 0) + 1;
        photoVersions.current.set(id, version);
        activePhotos++;
        void json<{ photos: FlightPhoto[] }>(`/api/flights/${id}/photos`, controller.signal).then(({ photos }) => {
          if (controller.signal.aborted || photoVersions.current.get(id) !== version) return;
          photosLoaded.current.add(id);
          setPayloads((old) => old[id] ? { ...old, [id]: { ...old[id], photos } } : old);
        }).catch(() => {
          if (!controller.signal.aborted && photoVersions.current.get(id) === version) {
            photosLoaded.current.add(id);
            setPhotoFailures((old) => [...new Set([...old, id])]);
          }
        }).finally(() => { activePhotos--; loadPhotos(); });
      }
    }
    loadPhotos();
    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        try {
          const replay = await json<ReplayResponse>(`/api/flights/${id}/replay`, controller.signal);
          if (replay.samples.length < 2) throw new Error("No track");
          if (!controller.signal.aborted) {
            setPayloads((old) => ({ ...old, [id]: { replay, photos: [] } }));
            photoQueue.push(id);
            loadPhotos();
          }
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
    ? flightForPilot(pilotFlights, timeMs, selection.flightId)
    : visibleFlights.find((f) => f.id === primaryId) ?? visibleFlights[0];

  const select = useCallback((pilot: ReplayPilot, flightId?: string) => {
    setVisibility((old) => ({ ...old, [pilot.id]: true }));
    setSelection({ pilotId: pilot.id, flightId: flightId ?? (pilot.id === primary.owner.id ? primaryId : "") });
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
    // A photo failure must not discard a usable track or reset the camera.
    photoFailures.forEach(id => photosLoaded.current.delete(id));
    setFailures([]);
    setPhotoFailures([]);
    setRetryVersion((v) => v + 1);
  }, [photoFailures]);
  const reloadPhotos = useCallback(async () => {
    const version = (photoVersions.current.get(primaryId) ?? 0) + 1;
    photoVersions.current.set(primaryId, version);
    try {
      const { photos } = await json<{ photos: FlightPhoto[] }>(`/api/flights/${primaryId}/photos`);
      if (photoVersions.current.get(primaryId) !== version) return;
      photosLoaded.current.add(primaryId);
      setPhotoFailures((old) => old.filter(id => id !== primaryId));
      setPayloads((old) => old[primaryId] ? { ...old, [primaryId]: { ...old[primaryId], photos } } : old);
    } catch { if (photoVersions.current.get(primaryId) === version) setPhotoFailures((old) => [...new Set([...old, primaryId])]); }
  }, [primaryId]);
  const timelineFlights = candidates.filter((f) => isVisible(f.owner.id)).map((f) => flights.find((loaded) => loaded.id === f.id) ?? f);
  const bounds = groupTimeBounds(timelineFlights);
  return { flights, visibleFlights, selected, pilots, candidates, isVisible, select, toggle, failures, photoFailures,
    primaryReplay: payloads[primaryId]?.replay ?? null, bounds, discover, discovering, discoveryError,
    dayExpanded: manifest.dayExpanded ?? false,
    nextCursor: manifest.nextCursor, retry, reloadPhotos };
}
