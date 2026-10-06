"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Cloud, Globe, Monitor, ThumbsUp } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { WingPairIcon } from "@/components/icons/wing-icon";
import { TrophyPill } from "@/components/logbook/trophy-pill";
import { defaultRowDesign, layoutRow, parseRowDesign, type RowColumn, type RowDesign, type RowElement } from "@/lib/row-design";

const STORAGE = "leaf-row-designer-v1";
type Mode = "feed" | "logbook";
type Drafts = Record<Mode, RowDesign>;
const button = "rounded-md border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-40";
const field = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-ink";

function NumberField({ label, value, onChange, max = 2000 }: { label: string; value: number; onChange: (n: number) => void; max?: number }) {
  return <label className="block text-xs text-gray-600">{label}<input aria-label={label} className={`${field} mt-1`} type="number" min={0} max={max} step={1} value={value} onChange={e => onChange(Math.min(max, Math.max(0, Number(e.target.value))))} /></label>;
}

function SampleElement({ element, long, trophyCount }: { element: RowElement; long: boolean; trophyCount: number }) {
  const { id, size } = element;
  const iconStyle = { width: size, height: size, flexShrink: 0 };
  let content: ReactNode;
  switch (id) {
    case "avatar": return <span style={{ display: "block", width: size, height: size }}><Avatar handle="samplepilot" displayName="Alex Rivera" avatarUpdatedAt={null} className="h-full w-full text-xs" /></span>;
    case "name": content = long ? "Alexandra Rivera-Montgomery" : "Alex Rivera"; break;
    case "handle": content = long ? "@alexandra_flies_everywhere" : "@alexflies"; break;
    case "date": content = "Sun, Sep 6, 2026"; break;
    case "time": content = "12:58"; break;
    case "duration": content = "1h 15m"; break;
    case "site": content = long ? "Mount Saint Helena — North Launch" : "Mission Peak"; break;
    case "landing": content = long ? "→ Robert Louis Stevenson Landing" : "→ Valley landing"; break;
    case "altitude": content = <span className="inline-flex items-center gap-1 text-brand-blue-strong"><Cloud style={{ width: 14, height: 14 }} />1,820 m</span>; break;
    case "friends": return <span title="You flew together" aria-label="You flew together" className="inline-flex items-center justify-center rounded-full bg-brand-blue text-white" style={{ width: size + 8, height: size }}><WingPairIcon style={iconStyle} /></span>;
    case "trophies": return <span className="flex gap-1" style={{ zoom: size / 24 }}>{Array.from({ length: trophyCount }, (_, i) => <TrophyPill key={i} trophies={[{ category: (["duration", "altitude", "open"] as const)[i], rank: (i + 1) as 1 | 2 | 3, value: [4500, 1820, 32400][i], approximate: false }]} />)}</span>;
    case "visibility": return <span title="Visibility: Public"><Globe style={iconStyle} /></span>;
    case "upload": return <span title="Manually uploaded"><Monitor style={iconStyle} /></span>;
    case "kudos": return <span title="Sample kudos (preview only)" className="inline-flex items-center gap-1"><ThumbsUp style={iconStyle} /><span className="text-xs">12</span></span>;
  }
  return <span className={`block truncate ${["name", "site", "date"].includes(id) ? "font-condensed font-bold" : "text-gray-600"}`} style={{ fontSize: size, lineHeight: 1.25 }} title={typeof content === "string" ? content : undefined}>{content}</span>;
}

function Preview({ design, width, guides, long, trophyCount, companions, selected, select, resize }: {
  design: RowDesign; width: number; guides: boolean; long: boolean; trophyCount: number; companions: boolean; selected: string;
  select?: (id: string) => void; resize?: (id: string, pixels: number) => void;
}) {
  const absent = [...(!companions ? ["friends"] : []), ...(trophyCount === 0 ? ["trophies"] : [])];
  const layout = layoutRow(design, width, absent);
  const groups = [
    { id: "pilot", columns: layout.columns.filter(c => c.id === "avatar" || c.id === "pilot") },
    { id: "flight", columns: layout.columns.filter(c => c.id !== "avatar" && c.id !== "pilot") },
  ];
  const drag = useRef<{ id: string; x: number; width: number } | null>(null);
  return <div>
    <div className="mb-2 flex gap-3 text-xs text-gray-500"><strong>{width}px row</strong><span>{layout.columns.length} columns</span><span className={layout.overflow ? "text-red-700" : ""}>{layout.overflow ? `${Math.round(layout.overflow)}px over budget` : `${Math.round(layout.unused)}px unallocated`}</span></div>
    <div className="overflow-x-auto pb-6 pt-3">
      <div data-row-preview={width} className="flex items-center" style={{ width, minHeight: design.height }}>
        {groups.filter(group => group.columns.length).map(group => <div key={group.id} data-row-group={group.id}
          className={`flex shrink-0 items-center ${group.id === "flight" ? "rounded-md border border-gray-300" : ""}`}
          style={group.id === "flight" ? { minHeight: design.height, padding: `6px ${design.padding}px`, background: "linear-gradient(100deg, #d8effb, #dcf6ae)" } : undefined}>
        {group.columns.map(c => <div key={c.id} data-column={c.id} onClick={() => select?.(c.id)} className="relative shrink-0" style={{ width: c.pixels, marginRight: c.after, outline: guides ? `1px ${selected === c.id ? "solid #007dcc" : "dashed #7997a5"}` : undefined, outlineOffset: 2, textAlign: c.align }}>
          {c.flow === "date-two-line" ? <div className="flex min-w-0 flex-col" style={{ gap: c.innerGap }}>
            {c.elements.filter(e => e.id === "date").map(e => <div key={e.id} data-element={e.id} className="min-w-0" style={{ marginTop: e.gap }}><SampleElement element={e} long={long} trophyCount={trophyCount} /></div>)}
            {c.elements.some(e => e.id !== "date") && <div className="flex min-w-0 items-baseline gap-1" style={{ justifyContent: c.align === "left" ? "flex-start" : c.align === "center" ? "center" : "flex-end" }}>
              {c.elements.filter(e => e.id !== "date").map((e, i) => <div key={e.id} className="flex min-w-0 items-baseline gap-1" style={{ marginTop: e.gap }}>
                {i > 0 && <span aria-hidden="true" className="shrink-0 text-xs text-gray-600">·</span>}
                <div data-element={e.id} className="min-w-0"><SampleElement element={e} long={long} trophyCount={trophyCount} /></div>
              </div>)}
            </div>}
          </div> : <div className="flex min-w-0" style={{ flexDirection: c.flow === "stack" ? "column" : "row", flexWrap: c.flow === "wrap" ? "wrap" : "nowrap", gap: c.innerGap, alignItems: c.flow !== "stack" ? "center" : c.align === "left" ? "stretch" : c.align === "center" ? "center" : "flex-end", justifyContent: c.flow === "stack" ? undefined : c.align === "left" ? "flex-start" : c.align === "center" ? "center" : "flex-end" }}>
            {c.elements.map(e => <div key={e.id} data-element={e.id} className="min-w-0 max-w-full" style={{ marginTop: e.gap }}><SampleElement element={e} long={long} trophyCount={trophyCount} /></div>)}
          </div>}
          {guides && resize && <button type="button" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} aria-valuenow={Math.round(c.pixels)} aria-valuemin={0} aria-valuemax={2000}
            title={`${c.label}: ${Math.round(c.pixels)}px. Drag or use arrow keys; resizing sets a pixel width.`}
            className="absolute -right-2 -top-3 z-10 h-[calc(100%+24px)] w-3 cursor-col-resize touch-none text-brand-blue-strong"
            onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: c.id, x: e.clientX, width: c.pixels }; select?.(c.id); }}
            onPointerMove={e => { if (drag.current?.id === c.id) resize(c.id, Math.min(2000, Math.max(c.min, Math.round(drag.current.width + e.clientX - drag.current.x)))); }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); resize(c.id, Math.min(2000, Math.max(c.min, c.pixels + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1)))); } }}>↔</button>}
        </div>)}
        </div>)}
      </div>
    </div>
    {layout.overflow > 0 && <p className="text-xs text-red-700">Columns exceed the row. Reduce widths or gaps, or raise hide thresholds. The preview intentionally exposes overflow.</p>}
  </div>;
}

export function RowDesigner() {
  const [drafts, setDrafts] = useState<Drafts>({ feed: defaultRowDesign("feed"), logbook: defaultRowDesign("logbook") });
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("feed");
  const [width, setWidth] = useState(1100);
  const [selected, setSelected] = useState("pilot");
  const [guides, setGuides] = useState(true);
  const [long, setLong] = useState(false);
  const [companions, setCompanions] = useState(true);
  const [trophyCount, setTrophyCount] = useState(3);
  const [compare, setCompare] = useState(false);
  const [message, setMessage] = useState("");
  const [transfer, setTransfer] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = localStorage.getItem(STORAGE);
        if (saved) { const parsed = JSON.parse(saved); setDrafts({ feed: parseRowDesign(JSON.stringify(parsed.feed)), logbook: parseRowDesign(JSON.stringify(parsed.logbook)) }); }
      } catch { setMessage("Saved draft could not be loaded. Defaults are shown."); }
      setReady(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (ready) { try { localStorage.setItem(STORAGE, JSON.stringify(drafts)); } catch { /* Export remains available when browser storage is disabled. */ } }
  }, [drafts, ready]);
  const design = drafts[mode];
  const current = design.columns.find(c => c.id === selected) ?? design.columns[0];
  const layout = layoutRow(design, width, [...(!companions ? ["friends"] : []), ...(trophyCount === 0 ? ["trophies"] : [])]);
  const update = (next: RowDesign) => setDrafts(previous => ({ ...previous, [mode]: next }));
  const changeColumn = (id: string, patch: Partial<RowColumn>) => update({ ...design, columns: design.columns.map(c => c.id === id ? { ...c, ...patch } : c) });
  const changeElement = (id: string, patch: Partial<RowElement>) => changeColumn(current.id, { elements: current.elements.map(e => e.id === id ? { ...e, ...patch } : e) });
  const canMove = (direction: number) => {
    const index = design.columns.findIndex(c => c.id === current.id);
    const neighbor = design.columns[index + direction];
    const outside = (id: string) => id === "avatar" || id === "pilot";
    return !!neighbor && outside(current.id) === outside(neighbor.id);
  };
  const move = (direction: number) => {
    const columns = [...design.columns], index = columns.findIndex(c => c.id === current.id), target = index + direction;
    if (!canMove(direction)) return;
    [columns[index], columns[target]] = [columns[target], columns[index]]; update({ ...design, columns });
  };
  return <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-8">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-widest text-brand-blue-strong">Leaf Log · Design workshop</p><h1 className="mt-2 font-condensed text-3xl font-bold">Flight row designer</h1><p className="mt-2 max-w-2xl text-sm text-gray-600">Tune space, test thresholds, and keep a reusable layout recipe. These are independent design drafts; they do not change the live Feed or Logbook.</p></div>
      <Link href="/feed" className={button}>Back to Feed</Link>
    </header>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {(["feed", "logbook"] as const).map(m => <button key={m} className={`${button} ${m === mode ? "!border-brand-blue !bg-blue-50" : ""}`} aria-pressed={m === mode} onClick={() => setMode(m)}>{m === "feed" ? "Feed draft" : "Logbook draft"}</button>)}
      <span className="ml-2 text-xs text-gray-500">{ready ? "Drafts saved in this browser" : "Loading drafts…"}</span>
      <button disabled={!ready} className={`${button} ml-auto`} onClick={() => update(defaultRowDesign(mode))}>Reset this draft</button>
    </div>
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5" aria-label="Live row preview">
      <div className="mb-5 flex flex-wrap items-end gap-5">
        <label className="min-w-48 flex-1 text-xs font-bold">Row width · {width}px<input aria-label="Preview row width" className="mt-3 block w-full accent-sky-500" type="range" min={280} max={1500} value={width} onChange={e => setWidth(Number(e.target.value))} /></label>
        <div className="w-24"><NumberField label="Width (px)" value={width} max={1500} onChange={n => setWidth(Math.max(280, n))} /></div>
        <div className="flex flex-wrap gap-1">{[320, 390, 640, 768, 1024, 1280].map(n => <button key={n} className={button} onClick={() => setWidth(n)}>{n}</button>)}</div>
      </div>
      <div className="mb-5 flex flex-wrap gap-4 text-xs">
        <label><input type="checkbox" checked={guides} onChange={e => setGuides(e.target.checked)} /> Guides & drag handles</label>
        <label><input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} /> Long names</label>
        <label><input type="checkbox" checked={companions} onChange={e => setCompanions(e.target.checked)} /> Friends present</label>
        <label>Trophies <select aria-label="Sample trophy count" className="rounded border bg-white" value={trophyCount} onChange={e => setTrophyCount(Number(e.target.value))}>{[0, 1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
        <label><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Compare 320 / 640 / 1024</label>
      </div>
      <Preview design={design} width={width} guides={guides} long={long} trophyCount={trophyCount} companions={companions} selected={selected} select={setSelected} resize={(id, pixels) => changeColumn(id, { width: pixels, unit: "px" })} />
      <p className="mt-3 text-xs text-gray-500">Thresholds use the entire preview row width, including pilot and kudos—not the browser width. Hidden and absent elements release their space. Nothing hides automatically.</p>
      {compare && <div className="mt-6 space-y-5 border-t border-gray-200 pt-5">{[320, 640, 1024].map(n => <Preview key={n} design={design} width={n} guides={false} long={long} trophyCount={trophyCount} companions={companions} selected="" />)}</div>}
    </section>
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 rounded-xl border border-gray-200 p-4">
        <h2 className="font-condensed text-xl font-bold">Column budget</h2><p className="mt-1 text-xs text-gray-500">Pixels are fixed. % uses inner row width before gaps. Flex shares leftover space by weight. Minimum widths can intentionally expose overflow.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="border-b text-gray-500"><tr>{["On", "Column", "Width", "Unit", "Min px", "Gap after", "Hide below", "At this width"].map(h => <th className="px-1 py-2" key={h}>{h}</th>)}</tr></thead><tbody>
          {design.columns.map(c => { const rendered = layout.columns.find(v => v.id === c.id); return <tr key={c.id} className={`border-b border-gray-100 ${current.id === c.id ? "bg-blue-50" : ""}`}>
            <td className="px-1"><input aria-label={`Enable ${c.label}`} type="checkbox" checked={c.enabled} onChange={e => changeColumn(c.id, { enabled: e.target.checked })} /></td>
            <td><button className="py-3 text-left font-bold" onClick={() => setSelected(c.id)}>{c.label}</button></td>
            {(["width"] as const).map(key => <td key={key} className="w-20 px-1"><input aria-label={`${c.label} width`} className={field} type="number" min={0} max={2000} value={c[key]} onChange={e => changeColumn(c.id, { [key]: Math.min(2000, Math.max(0, Number(e.target.value))) })} /></td>)}
            <td className="w-20 px-1"><select aria-label={`${c.label} width unit`} className={field} value={c.unit} onChange={e => changeColumn(c.id, { unit: e.target.value as RowColumn["unit"] })}><option>px</option><option>%</option><option>flex</option></select></td>
            {(["min", "gap", "drop"] as const).map(key => <td key={key} className="w-20 px-1"><input aria-label={`${c.label} ${key === "drop" ? "hide below" : key}`} className={field} type="number" min={0} max={key === "gap" ? 100 : 2000} value={c[key]} onChange={e => changeColumn(c.id, { [key]: Math.min(key === "gap" ? 100 : 2000, Math.max(0, Number(e.target.value))) })} /></td>)}
            <td className="px-2 text-gray-500">{rendered ? `${Math.round(rendered.pixels)}px` : !c.enabled ? "Off" : width < c.drop ? "Below threshold" : "No visible content"}</td>
          </tr>; })}
        </tbody></table></div>
      </section>
      <section className="rounded-xl border border-gray-200 p-4" aria-label="Selected column settings">
        <div className="flex items-center justify-between"><h2 className="font-condensed text-xl font-bold">{current.label}</h2><div className="flex gap-1"><button className={button} aria-label="Move column left" disabled={!canMove(-1)} onClick={() => move(-1)}>←</button><button className={button} aria-label="Move column right" disabled={!canMove(1)} onClick={() => move(1)}>→</button></div></div>
        {["avatar", "pilot"].includes(current.id) && <p className="mt-2 text-xs text-gray-500">Outside the colored flight card. Gap after Pilot controls the space before the card.</p>}
        <label className="mt-3 block text-xs">Alignment<select aria-label="Column alignment" className={`${field} mt-1`} value={current.align} onChange={e => changeColumn(current.id, { align: e.target.value as RowColumn["align"] })}><option>left</option><option>center</option><option>right</option></select></label>
        <div className="mt-3 grid grid-cols-2 gap-2"><label className="block text-xs text-gray-600">Element arrangement<select aria-label="Element arrangement" className={`${field} mt-1`} value={current.flow} onChange={e => changeColumn(current.id, { flow: e.target.value as RowColumn["flow"] })}><option value="stack">Stacked</option><option value="inline">Same line</option><option value="wrap">Wrap to fit</option>{current.id === "date" && <option value="date-two-line">Two lines: date / time & duration</option>}</select></label><NumberField label={current.flow === "date-two-line" ? "Between lines" : "Between elements"} value={current.innerGap} max={100} onChange={innerGap => changeColumn(current.id, { innerGap })} /></div>
        {current.flow === "date-two-line" && <p className="mt-2 text-xs text-gray-500">Day & Date on the first line; Time · Duration on the second. Individual hide thresholds still apply.</p>}
        {current.elements.map(e => <div key={e.id} className="mt-4 border-t border-gray-200 pt-3"><label className="text-sm font-bold"><input type="checkbox" checked={e.enabled} onChange={ev => changeElement(e.id, { enabled: ev.target.checked })} /> {e.label}</label><div className="mt-2 grid grid-cols-3 gap-2"><NumberField label={`${e.label} size`} value={e.size} max={100} onChange={size => changeElement(e.id, { size })} /><NumberField label={`${e.label} top gap`} value={e.gap} max={100} onChange={gap => changeElement(e.id, { gap })} /><NumberField label={`${e.label} hide below`} value={e.drop} onChange={drop => changeElement(e.id, { drop })} /></div><p className="mt-1 text-[11px] text-gray-500">{!e.enabled ? "Off" : width < e.drop ? `Hidden below ${e.drop}px` : "Enabled at this width"}</p></div>)}
        <p className="mt-3 text-xs text-gray-500">Size and gaps are pixels. A hide threshold of 0 means never hide. The column threshold also applies to every element inside it.</p>
      </section>
    </div>
    <section className="mt-5 grid gap-5 rounded-xl border border-gray-200 p-4 md:grid-cols-[250px_minmax(0,1fr)]">
      <div><h2 className="font-condensed text-xl font-bold">Row settings</h2><div className="mt-3 grid grid-cols-2 gap-3"><NumberField label="Side padding" value={design.padding} max={100} onChange={padding => update({ ...design, padding })} /><NumberField label="Min row height" value={design.height} max={200} onChange={height => update({ ...design, height })} /></div></div>
      <div><h2 className="font-condensed text-xl font-bold">Layout recipe</h2><p className="mt-1 text-xs text-gray-500">Export the current draft to share or keep a named file. Import replaces only the selected draft. Applying a recipe to real lists is a separate implementation step.</p><div className="my-3 flex flex-wrap gap-2"><button className={button} onClick={() => { const json = JSON.stringify(design, null, 2); setTransfer(json); const url = URL.createObjectURL(new Blob([json], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `leaf-${mode}-row.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("Recipe exported."); }}>Export JSON</button><button className={button} onClick={() => { setTransfer(JSON.stringify(design, null, 2)); setMessage("Current recipe shown below."); }}>Show current recipe</button><button className={button} onClick={() => { try { update(parseRowDesign(transfer)); setMessage("Recipe imported into this draft."); } catch { setMessage("Could not import: paste a valid exported row recipe."); } }}>Import pasted recipe</button></div><textarea aria-label="Layout recipe JSON" className={`${field} font-mono`} rows={4} placeholder="Export or paste a layout recipe here…" value={transfer} onChange={e => setTransfer(e.target.value)} /><p role="status" className="mt-2 text-xs text-brand-blue-strong">{message}</p></div>
    </section>
  </main>;
}
