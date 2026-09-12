import { emptyEntry, ENTRY_FIELDS, type EntryDraft, type EntryField } from "./entry";

export const MAX_CSV_BYTES = 2_000_000;
export const MAX_IMPORT_ROWS = 5000;
export type CsvTable = { headers: string[]; rows: { line: number; cells: string[] }[] };
export type ColumnMapping = Partial<Record<EntryField, number>>;
export type CsvOptions = { dateFormat: "ymd" | "mdy" | "dmy"; durationFormat: "minutes" | "hours" | "clock" | "seconds"; altitudeUnit: "m" | "ft"; distanceUnit: "km" | "mi" | "nmi"; varioUnit: "m/s" | "ft/min" | "knots"; timeZone: string };
export const CSV_DEFAULTS: CsvOptions = { dateFormat: "ymd", durationFormat: "minutes", altitudeUnit: "m", distanceUnit: "km", varioUnit: "m/s", timeZone: "" };
export type ImportRow = { line: number; draft: EntryDraft; excluded: boolean; allowDuplicate: boolean };

/** Quoted CSV, semicolon-separated spreadsheet exports, and tab-separated exports. */
export function parseCsv(input: string): CsvTable {
  if (new TextEncoder().encode(input).length > MAX_CSV_BYTES) throw new Error("Choose a CSV of 2 MB or less.");
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: CsvTable["rows"] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  const finishCell = () => { cells.push(cell); cell = ""; closed = false; };
  const finishRow = () => {
    finishCell();
    if (cells.some(value => value.trim())) rows.push({ line: start, cells });
    cells = [];
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} flights at a time.`);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else { cell += char; if (char === "\n") line++; }
    } else if (char === delimiter) finishCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow(); line++; start = line;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed && /\s/.test(char)) continue;
    else {
      if (closed || char === '"') throw new Error(`Unexpected quote near line ${line}. Save the spreadsheet as CSV and try again.`);
      cell += char;
    }
  }
  if (quoted) throw new Error(`Unclosed quote near line ${start}.`);
  if (cell || cells.length || closed) finishRow();
  const header = rows.shift();
  if (!header || !rows.length) throw new Error("Include a header row and at least one flight.");
  const headers = header.cells.map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new Error("Give each CSV column a unique, non-empty heading.");
  if (headers.length > 80) throw new Error("Use 80 columns or fewer.");
  for (const row of rows) {
    if (row.cells.length > headers.length) throw new Error(`Line ${row.line} has more values than headings. Check its commas and quotes.`);
    while (row.cells.length < headers.length) row.cells.push("");
  }
  return { headers, rows };
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Partial<Record<EntryField, string[]>> = {
  date: ["date", "flightdate"], durationMinutes: ["duration", "durationminutes", "airtime", "minutes"], glider: ["wing", "glider"],
  takeoffSiteName: ["site", "flyingsite", "takeoffsite", "launchsite"], landingSiteName: ["landingsite", "landing"],
  takeoffTime: ["takeofftime", "starttime", "time"], timeZone: ["timezone", "utcoffset"],
  maxAltitude: ["maxaltitude", "maximumaltitude", "maxalt"], launchAltitude: ["launchaltitude", "takeoffaltitude"],
  xcDistance: ["xcdistance", "distance"], xcType: ["xctype", "routetype", "distancetype"],
  takeoffLat: ["sitelatitude", "latitude", "lat"], takeoffLon: ["sitelongitude", "longitude", "lon"],
};
export function guessColumns(headers: string[]): ColumnMapping {
  return Object.fromEntries((Object.keys(ENTRY_FIELDS) as EntryField[]).flatMap(field => {
    const names = [normalize(field), normalize(ENTRY_FIELDS[field]), ...(aliases[field] ?? [])];
    const index = headers.findIndex(header => names.includes(normalize(header)));
    return index < 0 ? [] : [[field, index]];
  }));
}

export function csvEntries(table: CsvTable, mapping: ColumnMapping, options: CsvOptions): ImportRow[] {
  return table.rows.map(row => {
    const draft: EntryDraft = { ...emptyEntry(), altitudeUnit: options.altitudeUnit, distanceUnit: options.distanceUnit, varioUnit: options.varioUnit, timeZone: options.timeZone };
    for (const [field, index] of Object.entries(mapping)) if (index !== undefined && row.cells[index]?.trim()) draft[field as EntryField] = row.cells[index].trim();
    const day = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(draft.date);
    if (day) {
      const [year, month, date] = options.dateFormat === "ymd" ? [day[1], day[2], day[3]] : options.dateFormat === "mdy" ? [day[3], day[1], day[2]] : [day[3], day[2], day[1]];
      draft.date = `${year}-${month.padStart(2, "0")}-${date.padStart(2, "0")}`;
    }
    if (draft.durationMinutes) {
      const duration = draft.durationMinutes;
      if (options.durationFormat === "clock") {
        const clock = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(duration);
        draft.durationMinutes = clock ? String(Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 60) : duration;
        if (!clock) draft.durationMinutes = `Invalid duration: ${duration}`;
      } else if (/^\d+(?:\.\d+)?$/.test(duration)) {
        draft.durationMinutes = String(Number(duration) * (options.durationFormat === "hours" ? 60 : options.durationFormat === "seconds" ? 1 / 60 : 1));
      }
    }
    const typeAliases: Record<string, string> = { open: "open", opendistance: "open", freeflight: "open", faitriangle: "fai-triangle", freetriangle: "free-triangle", flattriangle: "free-triangle" };
    if (draft.xcType) draft.xcType = typeAliases[normalize(draft.xcType)] ?? draft.xcType;
    const units: Record<string, string> = { meters: "m", metres: "m", feet: "ft", miles: "mi", nauticalmiles: "nmi", kilometers: "km", kilometres: "km", fpm: "ft/min", kt: "knots", kts: "knots" };
    for (const field of ["altitudeUnit", "distanceUnit", "varioUnit"] as const) draft[field] = units[normalize(draft[field])] ?? draft[field].toLowerCase();
    draft.occupancy = draft.occupancy.toLowerCase();
    draft.flightTypes = draft.flightTypes.toLowerCase().split(/[;,]/).map(value => value.trim()).filter(Boolean).join(";");
    return { line: row.line, draft, excluded: false, allowDuplicate: false };
  });
}

export const CSV_HEADERS = Object.keys(ENTRY_FIELDS) as EntryField[];
export function templateCsv(example = false) {
  const rows: string[][] = [CSV_HEADERS.map(field => field === "heightGained" ? "total_climbs" : field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`))];
  if (example) {
    const draft = { ...emptyEntry(), date: "2020-06-15", durationMinutes: "95", glider: "My wing", takeoffSiteName: "My flying site", maxAltitude: "1800", xcDistance: "24.5", xcType: "open", notes: "Example only — replace with your own flight." };
    rows.push(CSV_HEADERS.map(field => draft[field]));
  }
  return "\uFEFF" + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
}
