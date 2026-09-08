import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const filePath = path.join(process.cwd(), "dev", "replay-palettes.json");
const emptyLibrary = { savedPresets: [], hiddenBuiltInIds: [] };

function developmentOnly() {
  return process.env.NODE_ENV === "development";
}

export async function GET() {
  if (!developmentOnly()) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return Response.json(emptyLibrary);
  }
}

export async function PUT(request: Request) {
  if (!developmentOnly()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json()) as {
    savedPresets?: unknown;
    hiddenBuiltInIds?: unknown;
  };
  if (!Array.isArray(body.savedPresets) || !Array.isArray(body.hiddenBuiltInIds)) {
    return Response.json({ error: "Invalid palette library" }, { status: 400 });
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        savedPresets: body.savedPresets,
        hiddenBuiltInIds: body.hiddenBuiltInIds,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return Response.json({ ok: true, file: "dev/replay-palettes.json" });
}
