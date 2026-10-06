export type RowElement = { id: string; label: string; enabled: boolean; drop: number; size: number; gap: number };
export type RowColumn = { id: string; label: string; enabled: boolean; unit: "px" | "%" | "flex"; width: number; min: number; gap: number; drop: number; align: "left" | "center" | "right"; flow: "stack" | "inline" | "wrap" | "date-two-line"; innerGap: number; elements: RowElement[] };
export type RowDesign = { version: 1; padding: number; height: number; columns: RowColumn[] };
const element = (id: string, label: string, size = 13): RowElement => ({ id, label, size, enabled: true, drop: 0, gap: 0 });
export function defaultRowDesign(mode: "feed" | "logbook"): RowDesign {
  const column = (id: string, label: string, width: number, elements: RowElement[], unit: RowColumn["unit"] = "px"): RowColumn => ({ id, label, width, unit, elements, min: 0, gap: 8, drop: 0, enabled: true, align: "left", flow: "stack", innerGap: 0 });
  const columns = [
    column("avatar", "Avatar", 32, [element("avatar", "Avatar", 32)]),
    column("pilot", "Pilot", 15, [element("name", "Name", 14), element("handle", "Handle", 12)], "%"),
    column("date", "Date & time", 120, [element("date", "Date", 13), element("time", "Takeoff time", 12), element("duration", "Duration", 12)]),
    column("site", "Site", 1, [element("site", "Takeoff site", 16), element("landing", "Landing site", 12)], "flex"),
    column("altitude", "Altitude", 80, [element("altitude", "Altitude", 13)]),
    column("friends", "Friends", 32, [element("friends", "Flew together", 24)]),
    column("trophies", "Trophies", 140, [element("trophies", "Trophies", 24)]),
    column("visibility", "Visibility", 24, [element("visibility", "Visibility", 20)]),
    column("upload", "Upload type", 28, [element("upload", "Upload type", 22)]),
    column("kudos", "Kudos", 42, [element("kudos", "Kudos", 16)]),
  ];
  if (mode === "logbook") for (const c of columns) if (["avatar", "pilot", "kudos"].includes(c.id)) c.enabled = false;
  return { version: 1, padding: 10, height: 54, columns };
}
export function layoutRow(design: RowDesign, rowWidth: number, absent: string[] = []) {
  // Identity columns remain outside, ahead of the colored flight card, including
  // when loading a recipe whose columns were previously reordered across groups.
  const ordered = [...design.columns.filter(c => c.id === "avatar" || c.id === "pilot"), ...design.columns.filter(c => c.id !== "avatar" && c.id !== "pilot")];
  const visible = ordered.flatMap(c => {
    const elements = c.elements.filter(e => e.enabled && rowWidth >= e.drop && !absent.includes(e.id));
    return c.enabled && rowWidth >= c.drop && elements.length ? [{ ...c, elements }] : [];
  });
  const hasFlightCard = visible.some(c => c.id !== "avatar" && c.id !== "pilot");
  const available = Math.max(0, rowWidth - (hasFlightCard ? 2 * design.padding + 2 : 0));
  const gaps = visible.reduce((n, c, i) => n + (i === visible.length - 1 ? 0 : c.gap), 0);
  const base = visible.map(c => Math.max(c.min, c.unit === "flex" ? 0 : c.unit === "%" ? available * c.width / 100 : c.width));
  const spare = Math.max(0, available - gaps - base.reduce((a, b) => a + b, 0));
  const weights = visible.reduce((n, c) => n + (c.unit === "flex" ? c.width : 0), 0);
  const columns = visible.map((c, i) => ({ ...c, pixels: base[i] + (c.unit === "flex" && weights ? spare * c.width / weights : 0), after: i === visible.length - 1 ? 0 : c.gap }));
  const used = columns.reduce((n, c) => n + c.pixels + c.after, 0);
  return { columns, overflow: Math.max(0, used - available), unused: Math.max(0, available - used) };
}
export function parseRowDesign(text: string): RowDesign {
  const value = JSON.parse(text) as RowDesign;
  const finite = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
  const known = defaultRowDesign("feed").columns;
  if (value.version !== 1 || !finite(value.padding, 100) || !finite(value.height, 200) || !Array.isArray(value.columns) || value.columns.length !== known.length) throw new Error("Invalid row design.");
  const ids = new Set<string>();
  for (const c of value.columns) {
    const template = known.find(k => k.id === c.id);
    if (!template || ids.has(c.id) || typeof c.enabled !== "boolean" || !["px", "%", "flex"].includes(c.unit) || !["left", "center", "right"].includes(c.align) || !finite(c.width, 2000) || !finite(c.min, 2000) || !finite(c.gap, 100) || !finite(c.drop, 2000) || !Array.isArray(c.elements) || c.elements.length !== template.elements.length) throw new Error("Invalid column settings.");
    ids.add(c.id);
    if (!(c.id === "date" ? ["stack", "inline", "wrap", "date-two-line"] : ["stack", "inline", "wrap"]).includes(c.flow) || !finite(c.innerGap, 100)) throw new Error("Invalid column arrangement.");
    const elements = new Set<string>();
    for (const e of c.elements) {
      if (!template.elements.some(t => t.id === e.id) || elements.has(e.id) || typeof e.enabled !== "boolean" || !finite(e.drop, 2000) || !finite(e.size, 100) || !finite(e.gap, 100)) throw new Error("Invalid element settings.");
      elements.add(e.id);
    }
  }
  value.columns = [...value.columns.filter(c => c.id === "avatar" || c.id === "pilot"), ...value.columns.filter(c => c.id !== "avatar" && c.id !== "pilot")];
  return value;
}
