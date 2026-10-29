"use client";

import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

export function MapCacheSettings() {
  const hydrated = useHydrated();
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");
  async function clear() {
    setClearing(true);
    try {
      await Promise.all([caches.delete("leaf-map-tiles-v1"), caches.delete("leaf-map-metadata-v1")]);
      navigator.serviceWorker?.controller?.postMessage("leaf-clear-map-cache");
      setMessage("Saved maps cleared. Maps will download again as you view them.");
    } catch { setMessage("Saved maps could not be cleared. Please try again."); }
    finally { setClearing(false); }
  }
  return <section className="rounded-lg border border-gray-200 p-4">
    <h2 className="font-condensed text-lg font-bold">Maps saved on this device</h2>
    <p className="mt-2 text-sm text-gray-600">Nearby flights can reuse maps you have already viewed, including after closing the browser. Saved maps use about 128 MB at most and expire within seven days, or sooner when required by the map provider.</p>
    <Button type="button" variant="outline" size="sm" className="mt-3" disabled={!hydrated || !("caches" in window) || clearing} onClick={clear}>{clearing ? "Clearing…" : "Clear saved maps"}</Button>
    <p role="status" className="mt-2 text-sm text-gray-600">{message}</p>
  </section>;
}
