import Link from "next/link";
import { ThumbsUp } from "lucide-react";
import {
  formatDuration,
  formatAltitude,
  formatLocalDate,
} from "@/lib/flights/format";
import type { FlightListItem } from "@/lib/flights/repo";
import { Avatar } from "@/components/avatar";

interface FlightRowOwner {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
}

export function FlightRow({
  flight,
  owner,
  kudoCount,
}: {
  flight: FlightListItem;
  owner?: FlightRowOwner;
  kudoCount?: number;
}) {
  const visibility =
    flight.visibility === "public"
      ? { label: "Public", className: "bg-leaf/15 text-leaf-strong" }
      : flight.visibility === "friends"
        ? { label: "Friends", className: "bg-amber/15 text-amber-strong" }
        : { label: "Private", className: "bg-gray-100 text-gray-500" };
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:bg-gray-50">
      {owner && (
        <Link
          href={`/@${owner.handle}`}
          className="flex min-w-0 shrink-0 items-center gap-2 text-sm text-gray-600 hover:text-ink"
        >
          <Avatar
            handle={owner.handle}
            displayName={owner.displayName}
            avatarUpdatedAt={owner.avatarUpdatedAt}
            className="h-9 w-9 text-xs"
          />
          <span className="hidden max-w-32 truncate font-mono text-xs sm:block">
            @{owner.handle}
          </span>
        </Link>
      )}
      <Link href={`/flights/${flight.id}`} className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-condensed text-lg font-bold text-ink hover:text-leaf-strong">
          {flight.takeoffSiteName ?? "Unknown site"}
        </span>
        <span className="text-sm text-gray-500">
          {formatLocalDate(
            flight.takeoffAt ?? flight.flightDate,
            flight.localUtcOffsetMinutes,
          )}
        </span>
      </Link>
      {flight.status === "failed" ? (
        <span className="text-sm text-amber-strong">Unreadable</span>
      ) : (
        <div className="flex items-center gap-4 text-sm text-gray-700 sm:gap-6">
          <span className="tabular-nums">{formatDuration(flight.durationS)}</span>
          <span className="hidden tabular-nums sm:inline">
            {formatAltitude(flight.maxAltM)}
          </span>
          {typeof kudoCount === "number" && (
            <span className="hidden items-center gap-1 tabular-nums text-gray-500 sm:inline-flex">
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
              {kudoCount}
            </span>
          )}
        </div>
      )}
      <span
        className={"rounded-sm px-2 py-0.5 text-xs font-medium " + visibility.className}
      >
        {visibility.label}
      </span>
    </div>
  );
}
