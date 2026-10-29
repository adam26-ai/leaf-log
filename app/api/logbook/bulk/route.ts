import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { listEditorFlights, saveBulkEdits } from "@/lib/logbook/bulk-edit";
import { entryJson, entryError, readEntryRequest } from "@/lib/logbook/http";

export async function POST(request: Request) {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return entryJson({ error: "Please sign in." }, 401);
  let committed: { updated: number; deleted: number } | null = null;
  try {
    const result = await saveBulkEdits(ownerId, await readEntryRequest(request));
    committed = result;
    revalidatePath("/", "layout");
    return entryJson({ ...result, flights: await listEditorFlights(ownerId) });
  } catch (error) {
    // A refresh failure after the transaction commits must not claim the save failed.
    if (committed) { console.error("Refresh after logbook bulk save:", error); return entryJson({ ...committed, refreshRequired: true }); }
    return entryError(error);
  }
}
