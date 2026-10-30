"use client";

import { useEffect } from "react";

/** Public tiles persist across map instances and sessions, within provider TTLs. */
export function MapTileCache() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    const register = () => { void navigator.serviceWorker.register("/map-tile-cache.js", { scope: "/" }).catch(() => {}); };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
