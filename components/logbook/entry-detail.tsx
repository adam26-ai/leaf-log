"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PhotoGallery } from "@/components/flight/photo-gallery";
import type { FlightPhoto } from "@/components/flight/photos";
const EntryMap = dynamic(() => import("./entry-map").then(module => module.EntryMap), { ssr: false });

export function EntryDetail({ flightId, source, locationSource, lat, lon, siteLat = null, siteLon = null, siteName, notes, owner }: { flightId: string; source: string; locationSource: string; lat: number | null; lon: number | null; siteLat?: number | null; siteLon?: number | null; siteName: string | null; notes: string | null; owner: boolean }) {
  const [photos, setPhotos] = useState<FlightPhoto[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/flights/${flightId}/photos`, { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => { if (result) setPhotos(result.photos); }).catch(() => {});
    return () => controller.abort();
  }, [flightId]);
  return <div className="mt-4 flex flex-col gap-5">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500"><span>{source === "csv_import" ? "Imported logbook entry" : "Manual logbook entry"} · no track recorded</span>
      {owner && <Link href={`/flights/${flightId}/edit`} className="text-brand-blue-strong underline">Edit details or attach an IGC</Link>}
    </div>
    {lat != null && lon != null ? <><p className="text-xs text-gray-600">Flight takeoff position · {locationSource === "csv" ? "Imported" : locationSource === "manual" ? "Manually entered" : locationSource === "flight_gps" ? "Recorded GPS" : "Source unknown"}</p><EntryMap lat={lat} lon={lon} label="Flight takeoff position" /></>
      : siteLat != null && siteLon != null ? <><p className="text-xs text-gray-600">Site location; takeoff position not recorded.</p><EntryMap lat={siteLat} lon={siteLon} pointType="site" label={siteName ?? "Site location"} /></>
      : <Card className="p-6 text-sm text-gray-500">{siteName ? `${siteName} has no map pin yet.` : "Site not recorded."}{owner && <Link href={`/flights/${flightId}/edit`} className="ml-1 text-brand-blue-strong underline">Edit the site to add a pin or boundary.</Link>}</Card>}
    {notes && <Card className="whitespace-pre-wrap p-5 text-sm text-gray-700">{notes}</Card>}
    <PhotoGallery flightId={flightId} photos={photos} openId={openId} onOpenChange={setOpenId} />
  </div>;
}
