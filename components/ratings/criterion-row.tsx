import { CircleCheck, Circle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Plain presentational row — RatingLevelCard computes the display value and
 * met/muted state per criterion kind; this component just renders one line.
 */
export interface CriterionRowProps {
  label: string;
  detail: string;
  met: boolean;
  /** instructor/future rows: greyed, non-alarming — not "locked" red/scary. */
  muted?: boolean;
}

export function CriterionRow({ label, detail, met, muted = false }: CriterionRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {met ? (
          <CircleCheck className="h-4 w-4 shrink-0 text-leaf" />
        ) : muted ? (
          <Lock className="h-4 w-4 shrink-0 text-gray-300" />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-gray-300" />
        )}
        <span className={cn("truncate text-sm", muted ? "text-gray-500" : "text-ink")}>
          {label}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm tabular-nums",
          muted ? "text-gray-400" : "text-gray-600",
        )}
      >
        {detail}
      </span>
    </div>
  );
}
