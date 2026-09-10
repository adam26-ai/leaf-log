import { ZodError } from "zod";
import { EntryError } from "./service";

export async function readLimitedBody(request: Request, limit = 16_000_000) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host") && origin !== new URL(request.url).origin) throw new EntryError("Use Leaf Log to submit this form.", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new EntryError("The form is empty.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new EntryError("This request is too large. Choose a smaller file or split the CSV into smaller imports.", 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function readEntryRequest(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new EntryError("Submit this form as JSON.");
  const body = await readLimitedBody(request);
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw new EntryError("The form could not be read. Please try again."); }
}
export const entryJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
export function entryError(error: unknown) {
  if (error instanceof EntryError) return entryJson({ error: error.message }, error.status);
  if (error instanceof ZodError) return entryJson({ error: "Some form values are invalid. Check the fields and try again." }, 400);
  console.error("Logbook entry:", error);
  return entryJson({ error: "Could not save. Your existing flights are unchanged; please retry." }, 500);
}
