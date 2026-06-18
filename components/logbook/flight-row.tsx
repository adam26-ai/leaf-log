import Link from "next/link";
import {
  formatDuration,
  formatAltitude,
  formatLocalDate,
} from "@/lib/flights/format";
import type { Tables } from "@/lib/database.types";

type FlightRowData = Pick<
  Tables<"flights">,
  | "id"
  | "flight_date"
  | "takeoff_at"
  | "takeoff_site_name"
  | "duration_s"
  | "max_alt_m"
  | "visibility"
  | "status"
  | "local_utc_offset_minutes"
>;

export function FlightRow({ flight }: { flight: FlightRowData }) {
  const isPublic = flight.visibility === "public";
  return (
    <Link
      href={`/flights/${flight.id}`}
      className="flex items-center gap-4 rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:bg-gray-50"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-condensed text-lg font-bold text-ink">
          {flight.takeoff_site_name ?? "Unknown site"}
        </span>
        <span className="text-sm text-gray-500">
          {formatLocalDate(
            flight.takeoff_at ?? flight.flight_date,
            flight.local_utc_offset_minutes,
          )}
        </span>
      </div>
      {flight.status === "failed" ? (
        <span className="text-sm text-amber-strong">Unreadable</span>
      ) : (
        <div className="flex items-center gap-6 text-sm text-gray-700">
          <span className="tabular-nums">{formatDuration(flight.duration_s)}</span>
          <span className="hidden tabular-nums sm:inline">
            {formatAltitude(flight.max_alt_m)}
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
