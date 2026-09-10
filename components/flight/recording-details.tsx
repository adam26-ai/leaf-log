import type { RecordingDetails as Details } from "@/lib/flights/igc-details";

export function RecordingDetails({ details }: { details: Details }) {
  const fields = [
    ["Pilot name in original IGC", details.originalPilot],
    ["Recorder", details.recorder],
    ["Wing in original IGC", details.originalGlider],
  ].filter(([, value]) => Boolean(value));
  // Native disclosures can be opened before React loads; preserve that browser-owned state.
  return <details suppressHydrationWarning>
    <summary className="cursor-pointer font-condensed text-lg font-bold text-ink">Recording details</summary>
    <p className="mt-3 text-sm text-gray-500">Information from the recording. The flight uses its owner’s Leaf Log profile for pilot identity.</p>
    {!details.originalAvailable && <p className="mt-3 text-sm text-gray-500">The original IGC file is unavailable.</p>}
    {fields.length > 0 && <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-gray-500">{label}</dt><dd className="mt-1 break-words text-ink">{value}</dd></div>)}</dl>}
    {details.originalAvailable && fields.length === 0 && <p className="mt-3 text-sm text-gray-500">No pilot, recorder, or wing information was included in this IGC.</p>}
    {details.savedPilotLabel !== null && <div className="mt-4 border-t border-gray-200 pt-3 text-sm">
      <p className="text-gray-500">Previously saved pilot label</p>
      <p className="mt-1 break-words text-ink">{details.savedPilotLabel || "Label was cleared"}</p>
      <p className="mt-1 text-xs text-gray-500">Preserved from earlier flight details; this does not change the flight’s pilot identity.</p>
    </div>}
  </details>;
}
