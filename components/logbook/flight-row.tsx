import Link from "next/link";
import {
  formatDuration,
  formatAltitude,
  formatLocalDate,
} from "@/lib/flights/format";
import type { FlightListItem } from "@/lib/flights/repo";

export function FlightRow({ flight }: { flight: FlightListItem }) {
  const isPublic = flight.visibility === "public";
  return (
    <Link
      href={`/flights/${flight.id}`}
      className="flex items-center gap-4 rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:bg-gray-50"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-condensed text-lg font-bold text-ink">
          {flight.takeoffSiteName ?? "Unknown site"}
        </span>
        <span className="text-sm text-gray-500">
          {formatLocalDate(
            flight.takeoffAt ?? flight.flightDate,
            flight.localUtcOffsetMinutes,
          )}
        </span>
      </div>
      {flight.status === "failed" ? (
        <span className="text-sm text-amber-strong">Unreadable</span>
      ) : (
        <div className="flex items-center gap-6 text-sm text-gray-700">
          <span className="tabular-nums">{formatDuration(flight.durationS)}</span>
          <span className="hidden tabular-nums sm:inline">
            {formatAltitude(flight.maxAltM)}
          </span>
        </div>
      )}
      <span
        className={
          "rounded-sm px-2 py-0.5 text-xs font-medium " +
          (isPublic ? "bg-leaf/15 text-leaf-strong" : "bg-gray-100 text-gray-500")
        }
      >
        {isPublic ? "Public" : "Private"}
      </span>
    </Link>
  );
}
