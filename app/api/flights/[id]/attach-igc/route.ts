import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { attachIgc } from "@/lib/logbook/attach-igc";
import { entryError, entryJson, readLimitedBody } from "@/lib/logbook/http";
import { EntryError } from "@/lib/logbook/service";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = (await auth())?.user?.id;
    if (!ownerId) return entryJson({ error: "Sign in to attach a recording." }, 401);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new EntryError("Choose an IGC file.");
    const body = await readLimitedBody(request, 5 * 1024 * 1024 + 10000);
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".igc")) throw new EntryError("Choose an .igc file.");
    const operation = form.get("operation");
    if (operation !== "preview" && operation !== "commit") throw new EntryError("Review the file before attaching it.");
    const result = await attachIgc(ownerId, (await params).id, new Uint8Array(await file.arrayBuffer()), operation === "commit", String(form.get("expectedUpdatedAt") ?? ""), String(form.get("hash") ?? ""));
    if (result.attached) revalidatePath("/", "layout");
    return entryJson(result);
  } catch (error) { return entryError(error); }
}
