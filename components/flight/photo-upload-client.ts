export interface PhotoUploadResult {
  filename: string;
  status: "placed" | "unplaced" | "skipped_dupe" | "rejected";
  reason?: string;
}

/**
 * Upload photos as separate requests. Phone photos are often several megabytes
 * each, so combining a whole selection into one multipart body can exceed a
 * proxy's request limit even though every individual image is acceptable.
 */
export async function uploadPhotoFiles(
  flightId: string,
  files: File[],
): Promise<PhotoUploadResult[]> {
  const results: PhotoUploadResult[] = [];

  for (const file of files) {
    const form = new FormData();
    form.append("files", file);

    try {
      const response = await fetch(`/api/flights/${flightId}/photos`, {
        method: "POST",
        body: form,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        results.push({
          filename: file.name,
          status: "rejected",
          reason: json.error ?? "Upload failed",
        });
        continue;
      }
      results.push(...(json.results ?? []));
    } catch {
      results.push({
        filename: file.name,
        status: "rejected",
        reason: "Network error",
      });
    }
  }

  return results;
}
