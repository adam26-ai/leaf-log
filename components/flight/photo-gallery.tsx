"use client";

import { useCallback, useEffect, useState } from "react";
import { photoUrl, unpinnedReason, type FlightPhoto } from "./photos";

/**
 * Thumbnail grid + lightbox (prev/next, keyboard). Owners can delete. Clicking a
 * thumbnail also scrubs the replay to the photo's moment when it's time-placed.
 */
export function PhotoGallery({
  flightId,
  photos,
  isOwner,
  onSelect,
  onChanged,
}: {
  flightId: string;
  photos: FlightPhoto[];
  isOwner: boolean;
  onSelect?: (tSec: number) => void;
  onChanged?: () => void;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const close = useCallback(() => setOpenIdx(null), []);
  const step = useCallback(
    (dir: number) =>
      setOpenIdx((i) => (i == null ? i : (i + dir + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    if (openIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, close, step]);

  async function del(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    const res = await fetch(`/api/flights/${flightId}/photos/${photoId}`, { method: "DELETE" });
    if (res.ok) {
      close();
      onChanged?.();
    }
  }

  if (photos.length === 0) return null;
  const open = openIdx != null ? photos[openIdx] : null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-condensed text-sm font-bold uppercase tracking-wide text-gray-500">
        Photos
      </h2>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setOpenIdx(i);
              if (p.tSec != null) onSelect?.(p.tSec);
            }}
            className="group relative h-20 w-20 overflow-hidden rounded-md border border-gray-200 bg-gray-100"
            title={p.placementSource === "unpinned" ? `Unpinned — ${unpinnedReason(p)}` : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(flightId, p.id, "thumb")}
              alt={p.originalFilename ?? "Flight photo"}
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:opacity-90"
            />
            {p.placementSource === "unpinned" && (
              <span className="absolute bottom-0 right-0 bg-ink/70 px-1 text-[9px] font-bold text-paper">
                unpinned
              </span>
            )}
          </button>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={close}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(flightId, open.id, "display")}
              alt={open.originalFilename ?? "Flight photo"}
              className="max-h-[85vh] w-auto rounded-md"
            />
            <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-2 text-paper">
              <span className="rounded bg-ink/60 px-2 py-0.5 text-xs">
                {(openIdx ?? 0) + 1} / {photos.length}
              </span>
              <div className="flex items-center gap-2">
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => del(open.id)}
                    className="rounded bg-ink/60 px-2 py-0.5 text-xs hover:bg-red-600"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="rounded bg-ink/60 px-2 py-0.5 text-xs hover:bg-ink"
                >
                  Close
                </button>
              </div>
            </div>
            {photos.length > 1 && (
              <>
                <NavButton side="left" onClick={() => step(-1)} />
                <NavButton side="right" onClick={() => step(1)} />
              </>
            )}
            {open.placementSource === "unpinned" && (
              <div className="absolute bottom-0 left-0 right-0 bg-ink/70 px-3 py-1.5 text-center text-xs text-paper">
                Not on the map — {unpinnedReason(open)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2" : "right-2"} flex h-9 w-9 items-center justify-center rounded-full bg-ink/60 text-lg text-paper hover:bg-ink`}
      aria-label={side === "left" ? "Previous" : "Next"}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
