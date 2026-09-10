import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { commitLogbookImport, previewLogbookImport } from "@/lib/logbook/service";
import { readEntryRequest, entryJson, entryError } from "@/lib/logbook/http";

export async function POST(request: Request) {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return entryJson({ error: "Please sign in." }, 401);
  try {
    const value = await readEntryRequest(request);
    if (new URL(request.url).searchParams.get("preview") === "1") return entryJson(await previewLogbookImport(ownerId, value));
    const result = await commitLogbookImport(ownerId, value);
    revalidatePath("/", "layout");
    return entryJson(result);
  } catch (error) { return entryError(error); }
}
