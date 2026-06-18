import { AccentBar } from "@/components/ui/accent-bar";

export interface LogbookStats {
  totalSeconds: number;
  flightCount: number;
  siteCount: number;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-condensed text-3xl font-bold tabular-nums text-ink">
        {value}
      </span>
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

/** Solo-value progress: stands on its own even if nothing is ever shared. */
export function StatsBar({ stats }: { stats: LogbookStats }) {
  const hours = Math.floor(stats.totalSeconds / 3600);
  const mins = Math.round((stats.totalSeconds % 3600) / 60);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-10">
        <Stat label="Airtime" value={hours > 0 ? `${hours}h ${mins}m` : `${mins}m`} />
        <Stat label="Flights" value={String(stats.flightCount)} />
        <Stat label="Sites" value={String(stats.siteCount)} />
      </div>
      <AccentBar width="3rem" />
    </div>
  );
}
