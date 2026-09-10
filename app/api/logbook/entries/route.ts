import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { saveLogbookEntry } from "@/lib/logbook/service";
import { readEntryRequest, entryJson, entryError } from "@/lib/logbook/http";

export async function POST(request: Request) {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return entryJson({ error: "Please sign in." }, 401);
  try {
    const result = await saveLogbookEntry(ownerId, await readEntryRequest(request));
    if ("id" in result) revalidatePath("/", "layout");
    return entryJson(result);
  } catch (error) { return entryError(error); }
}
