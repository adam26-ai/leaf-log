"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface AvatarCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VIEW = 288; // square viewport, px
const MAX_ZOOM = 4;

/**
 * Pan/zoom an image inside a circular mask and emit the chosen region as a
 * normalized crop (fractions of the natural image). The viewport is square; the
 * circle is just a visual guide — the server squares whatever rect we send.
 */
export function AvatarCropper({
  file,
  busy,
  onCancel,
  onConfirm,
}: {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (crop: AvatarCrop) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // top-left of image in viewport px
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Set the blob src imperatively (and revoke in cleanup): under React
  // StrictMode the mount→cleanup→mount cycle would revoke a render-created URL
  // and leave the <img> pointing at a dead blob. Each mount makes a fresh one.
  useEffect(() => {
    const u = URL.createObjectURL(file);
    if (imgRef.current) imgRef.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Smallest scale that still covers the square viewport (object-fit: cover).
  const sMin = nat ? VIEW / Math.min(nat.w, nat.h) : 1;
  const scale = sMin * zoom;

  const clampOffset = useCallback(
    (o: { x: number; y: number }, s: number) => {
      if (!nat) return o;
      const minX = VIEW - nat.w * s;
      const minY = VIEW - nat.h * s;
      return {
        x: Math.min(0, Math.max(minX, o.x)),
        y: Math.min(0, Math.max(minY, o.y)),
      };
    },
    [nat],
  );

  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNat({ w, h });
    const s = VIEW / Math.min(w, h);
    setZoom(1);
    setOffset({ x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 }); // centered
  }

  function applyZoom(nextZoom: number) {
    if (!nat) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
    const nextScale = sMin * z;
    const c = VIEW / 2;
    // Keep the image point under the viewport center fixed while zooming.
    setOffset((o) =>
      clampOffset(
        { x: c - ((c - o.x) * nextScale) / scale, y: c - ((c - o.y) * nextScale) / scale },
        nextScale,
      ),
    );
    setZoom(z);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const d = drag.current;
    setOffset(clampOffset({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }, scale));
  }
  function onPointerUp() {
    drag.current = null;
  }

  function confirm() {
    if (!nat) return;
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    const cropPx = VIEW / scale; // natural px covered by the viewport
    onConfirm({
      x: clamp01(-offset.x / scale / nat.w),
      y: clamp01(-offset.y / scale / nat.h),
      w: clamp01(cropPx / nat.w),
      h: clamp01(cropPx / nat.h),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Position your photo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="font-condensed text-lg font-bold text-ink">Position your photo</h2>
        <div
          className="relative mx-auto touch-none overflow-hidden rounded-md bg-gray-100 select-none"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            alt=""
            draggable={false}
            onLoad={onLoad}
            className="pointer-events-none absolute max-w-none origin-top-left"
            style={
              nat
                ? {
                    width: nat.w * scale,
                    height: nat.h * scale,
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                  }
                : { visibility: "hidden" }
            }
          />
          {/* Circular guide: dims everything outside the circle. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1 flex-1 accent-amber"
          />
        </div>
        <p className="text-xs text-gray-500">Drag to reposition · scroll or use the slider to zoom.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy || !nat} onClick={confirm}>
            {busy ? "Saving…" : "Save photo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
