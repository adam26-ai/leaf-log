import { analysisPending, analysisState, type AnalysisFlight } from "@/lib/flights/analysis-state";
import { CalculateXcButton } from "./calculate-xc-button";

export function AnalysisStatus({ flight, owner = false, compact = false }: {
  flight: AnalysisFlight & { id: string; launchAltM?: number | null }; owner?: boolean; compact?: boolean;
}) {
  const state = analysisState(flight);
  // Compact logbook notices are reserved for work that can be resolved.
  if (compact && (!owner || !state.incomplete || (!state.action && !analysisPending(flight.xcStatus)))) return null;
  const missingAltitude = !compact && flight.status === "ready" && flight.metricsVersion === 1 && flight.launchAltM === null;
  return <div data-flight-analysis={flight.id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 ${compact ? "mt-1 justify-end" : ""}`}>
    {state.action && owner && state.action !== "improve"
      ? <span title={state.detail}><CalculateXcButton flightId={flight.id} label={state.label} subtle={compact} /></span>
      : <details className="relative">
          <summary className="cursor-pointer list-none underline decoration-dotted underline-offset-4">{state.label}</summary>
          <div className="mt-1 max-w-xs space-y-1 text-xs">
            <p>{state.detail}</p>
            {state.action === "improve" && owner && <CalculateXcButton flightId={flight.id} label="Improve XC" />}
          </div>
        </details>}
    {missingAltitude && <span title="The original file has no usable launch altitude. Altitude-based records are excluded where data is missing.">Launch altitude unavailable</span>}
  </div>;
}
