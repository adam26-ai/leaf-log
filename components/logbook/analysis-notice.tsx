import { analysisState, RUNNING_STATES, WAITING_STATES, type AnalysisFlight } from "@/lib/flights/analysis-state";
import { CalculateXcButton } from "@/components/flight/calculate-xc-button";

export function AnalysisNotice({ flights, now }: { flights: (AnalysisFlight & { xcQueuedAt?: Date | string | null })[]; now: number }) {
  const states = flights.map(analysisState);
  const missing = states.filter(state => state.action && ["calculate", "retry", "complete"].includes(state.action)).length;
  const repairs = states.filter(state => state.action === "repair").length;
  const waiting = flights.filter(flight => WAITING_STATES.includes(flight.xcStatus)).length;
  const running = flights.filter(flight => RUNNING_STATES.includes(flight.xcStatus)).length;
  const unavailable = states.filter(state => !state.action && state.incomplete && !["Waiting", "Calculating…", "Repairing data…"].includes(state.label)).length;
  if (!states.some(state => state.incomplete)) return null;
  const delayed = flights.some(flight => WAITING_STATES.includes(flight.xcStatus) && flight.xcQueuedAt && now - new Date(flight.xcQueuedAt).getTime() > 120_000);
  return <aside aria-label="Flight calculations" className="mt-5 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-600">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {missing > 0 && <span>{missing} {missing === 1 ? "flight needs" : "flights need"} XC <CalculateXcButton kind="xc" label="Calculate missing XC" /></span>}
      {repairs > 0 && <span>{repairs} {repairs === 1 ? "flight needs" : "flights need"} repair <CalculateXcButton kind="repair" label="Repair flight data" /></span>}
      {(waiting > 0 || running > 0) && <span role="status">{[waiting ? `${waiting} waiting` : "", running ? `${running} calculating` : ""].filter(Boolean).join(" · ")}</span>}
      {unavailable > 0 && <span>{unavailable} {unavailable === 1 ? "flight has" : "flights have"} unavailable data</span>}
    </div>
    <p className="mt-1 text-[11px] text-gray-500">XC personal bests are based on scored flights. Rankings may change as calculations finish.</p>
    {delayed && <p className="mt-1 text-[11px] text-gray-500">Still waiting for background processing. Work resumes when the server is available.</p>}
  </aside>;
}
