"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Info, LoaderCircle, Triangle, TriangleRight, Waypoints, X } from "lucide-react";
import type { Flight } from "@prisma/client";
import { analysisPending, analysisState } from "@/lib/flights/analysis-state";
import { formatDistance } from "@/lib/flights/format";
import { toggleReplayXcRoute } from "@/lib/flights/replay-events";
import { useUnits } from "@/lib/flights/use-units";
import { readXcScore } from "@/lib/igc/xc-types";
import { CalculateXcButton } from "./calculate-xc-button";

/** Keep every state inside the same two lines as the other replay metrics. */
export function XcStatistic({ flight, owner }: { flight: Flight; owner: boolean }) {
  const [units] = useUnits();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const xc = readXcScore(flight.xcScore);
  const state = analysisState(flight);
  const pending = analysisPending(flight.xcStatus);
  const Icon = xc?.best.shape === "fai-triangle" ? Triangle : xc?.best.shape === "free-triangle" ? TriangleRight : Waypoints;
  const showDetails = state.label !== "Calculated";

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div ref={container} className="relative flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
    <div className="flex h-5 min-w-0 items-center gap-1">
      {xc ? <button type="button" onClick={toggleReplayXcRoute}
        title={`${xc.best.name}: ${formatDistance(xc.best.distanceM, units)} credited distance. Click to show or hide the scored route.`}
        className="flex min-w-0 items-center gap-1.5 rounded-md text-left hover:bg-gray-100">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--replay-metric-icon-bg)]">
          <Icon className="h-3.5 w-3.5 text-[var(--replay-icon)] [stroke-width:var(--replay-metric-icon-stroke)]" />
        </span>
        <span className="truncate whitespace-nowrap font-condensed text-base font-bold tabular-nums text-ink">{formatDistance(xc.best.distanceM, units)}</span>
      </button> : state.action && owner
        ? <CalculateXcButton flightId={flight.id} label={state.label} inline />
        : <span className="font-condensed text-base font-bold text-ink">—</span>}
      {showDetails && <button ref={trigger} type="button" aria-label={`XC details: ${state.label}`}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}
        title={state.label} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-ink">
        {pending ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          : xc?.approximate && state.action === "improve" ? <span aria-hidden="true" className="text-base leading-none">≈</span>
          : state.action === "retry" ? <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
          : <Info aria-hidden="true" className="h-3.5 w-3.5" />}
      </button>}
    </div>
    <span className="truncate whitespace-nowrap text-[9px] font-medium uppercase tracking-wide text-gray-500">{xc?.best.name ?? "XC distance"}</span>
    {open && showDetails && <div id={panelId} role="region" aria-label="XC calculation details"
      className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[80vw] rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">{state.label}</span>
        <button type="button" aria-label="Close XC details" onClick={() => { setOpen(false); trigger.current?.focus(); }}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-gray-100"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
      </div>
      <p>{state.detail}</p>
      {state.action && owner && <div className="mt-2"><CalculateXcButton flightId={flight.id} label={state.action === "improve" ? "Improve XC" : state.label} /></div>}
    </div>}
  </div>;
}
