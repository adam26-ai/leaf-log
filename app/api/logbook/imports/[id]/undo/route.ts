import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { undoLogbookImport } from "@/lib/logbook/service";
import { readEntryRequest, entryJson, entryError } from "@/lib/logbook/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return entryJson({ error: "Please sign in." }, 401);
  try {
    await readEntryRequest(request);
    const result = await undoLogbookImport(ownerId, (await params).id);
    revalidatePath("/", "layout");
    return entryJson(result);
  } catch (error) { return entryError(error); }
}
