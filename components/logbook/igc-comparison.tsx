import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/flights/format";

export type IgcFacts = {
  date: string;
  durationS: number | null;
  maxAltM: number | null;
  launchAltM: number | null;
  altGainM: number | null;
  maxClimbMs: number | null;
  maxSinkMs: number | null;
  takeoffAt: string | null;
  landingAt: string | null;
  takeoffLat: number | null;
  takeoffLon: number | null;
  landingLat: number | null;
  landingLon: number | null;
};

export type IgcComparisonPreview = {
  hash: string;
  expectedUpdatedAt: string;
  mergeable: boolean;
  warnings: string[];
  previous: IgcFacts;
  recorded: IgcFacts;
};

const labels: Partial<Record<keyof IgcFacts, string>> = {
  date: "Flight date",
  durationS: "Duration",
  maxAltM: "Maximum altitude",
  launchAltM: "Launch altitude",
  altGainM: "Total climbs",
  maxClimbMs: "Best climb",
  maxSinkMs: "Max sink",
  takeoffAt: "Takeoff",
  landingAt: "Landing",
};

function display(field: keyof IgcFacts, value: IgcFacts[keyof IgcFacts]) {
  if (value == null) return "Unknown";
  if (field === "durationS") return formatDuration(Number(value));
  if (["maxAltM", "launchAltM", "altGainM"].includes(field)) return `${value} m`;
  if (["maxClimbMs", "maxSinkMs"].includes(field)) return `${Number(value).toFixed(1)} m/s`;
  if (field.endsWith("At")) return String(value).replace("T", " ").replace(".000Z", " UTC");
  return String(value);
}

export function IgcComparison({
  preview,
  pending = false,
  onMerge,
  existingColumnLabel = "Entered",
  uploadedColumnLabel = "From IGC",
  mergeLabel = "Attach IGC and use recorded measurements",
}: {
  preview: IgcComparisonPreview;
  pending?: boolean;
  onMerge?: () => void;
  existingColumnLabel?: string;
  uploadedColumnLabel?: string;
  mergeLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="p-2">Detail</th>
              <th className="p-2">{existingColumnLabel}</th>
              <th className="p-2">{uploadedColumnLabel}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(labels).map(([field, label]) => (
              <tr key={field} className="border-b border-gray-100">
                <th className="p-2 font-medium">{label}</th>
                <td className="p-2">{display(field as keyof IgcFacts, preview.previous[field as keyof IgcFacts])}</td>
                <td className="p-2">{display(field as keyof IgcFacts, preview.recorded[field as keyof IgcFacts])}</td>
              </tr>
            ))}
            {(["takeoff", "landing"] as const).map((endpoint) => (
              <tr key={endpoint}>
                <th className="p-2 font-medium">{endpoint === "takeoff" ? "Takeoff" : "Landing"} coordinates</th>
                {([preview.previous, preview.recorded] as const).map((facts, index) => (
                  <td key={index} className="p-2">
                    {facts[`${endpoint}Lat`] == null || facts[`${endpoint}Lon`] == null
                      ? "Unknown"
                      : `${facts[`${endpoint}Lat`]!.toFixed(5)}, ${facts[`${endpoint}Lon`]!.toFixed(5)}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.mergeable && onMerge ? (
        <p className="text-gray-600">
          Attaching replaces these measurements and adds the recorded track to this same flight. Your wing, chosen site names, notes, photos, visibility, and reported XC result are kept. Blank wings and sites may be filled from the recording. XC calculation runs separately.
        </p>
      ) : !onMerge ? (
        <p className="text-gray-600">
          This comparison is read-only. Keeping or discarding the upload will not change the existing flight.
        </p>
      ) : (
        <p className="text-gray-600">
          This existing flight already has an IGC recording, so Leaf Log cannot merge another recording into it. Use the comparison to decide whether to view the existing flight or add this upload separately.
        </p>
      )}
      {preview.previous.date !== preview.recorded.date && (
        <p className="rounded border border-emergency-orange/25 bg-emergency-orange-light p-3 text-emergency-orange">
          The recording is from a different date. Make sure it belongs to this flight.
        </p>
      )}
      {preview.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-gray-500">
          {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}
      {preview.mergeable && onMerge && (
        <Button className="self-start" disabled={pending} onClick={onMerge}>
          {pending ? "Attaching…" : mergeLabel}
        </Button>
      )}
    </div>
  );
}
