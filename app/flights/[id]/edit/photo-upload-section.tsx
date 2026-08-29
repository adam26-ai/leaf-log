"use client";

import { useRouter } from "next/navigation";
import { PhotoUpload } from "@/components/flight/photo-upload";

/** Thin client wrapper — a Server Component can't pass a raw callback prop
 *  into PhotoUpload, so this supplies the refresh itself. */
export function PhotoUploadSection({ flightId }: { flightId: string }) {
  const router = useRouter();
  return <PhotoUpload flightId={flightId} onUploaded={() => router.refresh()} />;
}
