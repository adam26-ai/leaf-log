"use client";

import { useCallback, useEffect, useState } from "react";
import { PhotoUpload } from "@/components/flight/photo-upload";
import { PhotoGallery } from "@/components/flight/photo-gallery";
import type { FlightPhoto } from "@/components/flight/photos";

/** Upload + manage a flight's photos — the only place photos can be
 *  deleted from (the flight page shows them read-only). */
export function PhotosSection({ flightId }: { flightId: string }) {
  const [photos, setPhotos] = useState<FlightPhoto[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadPhotos = useCallback(() => {
    fetch(`/api/flights/${flightId}/photos`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPhotos(d.photos ?? []))
      .catch(() => {});
  }, [flightId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  return (
    <div className="flex flex-col gap-4">
      <PhotoUpload flightId={flightId} onUploaded={loadPhotos} />
      <PhotoGallery
        flightId={flightId}
        photos={photos}
        canDelete
        openId={openId}
        onOpenChange={setOpenId}
        onChanged={loadPhotos}
      />
    </div>
  );
}
