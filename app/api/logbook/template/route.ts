import { templateCsv } from "@/lib/logbook/csv";

export async function GET(request: Request) {
  const example = new URL(request.url).searchParams.get("example") === "1";
  return new Response(templateCsv(example), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leaf-log-${example ? "example" : "template"}.csv"`, "x-content-type-options": "nosniff" } });
}
