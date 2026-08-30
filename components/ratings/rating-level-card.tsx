import { CircleCheck } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { AccentBar } from "@/components/ui/accent-bar";
import { CriterionRow } from "@/components/ratings/criterion-row";
import type { RatingCriterion, RatingLevel } from "@/lib/ratings/criteria";
import type { RatingStats } from "@/lib/ratings/stats";

const LEVEL_NAMES: Record<RatingLevel, string> = {
  P2: "P2 — Novice",
  P3: "P3 — Intermediate",
  P4: "P4 — Advanced",
};

function formatDetail(criterion: RatingCriterion, value: number): string {
  const shown = criterion.unit === "hours" ? value.toFixed(1) : String(Math.round(value));
  const base = `${shown} / ${criterion.required}`;
  return criterion.unit ? `${base} ${criterion.unit}` : base;
}

/**
 * One P2/P3/P4 card: an `auto` row reads its live value straight off
 * `RatingStats`; `instructor`/`future` rows always render greyed and unmet
 * in PR1 — they only start reporting real progress once PR5 wires signoffs.
 */
export function RatingLevelCard({
  level,
  criteria,
  stats,
}: {
  level: RatingLevel;
  criteria: RatingCriterion[];
  stats: RatingStats;
}) {
  const rows = criteria.map((criterion) => {
    if (criterion.kind === "auto") {
      const value = criterion.getValue!(stats);
      return {
        criterion,
        met: value >= criterion.required,
        detail: formatDetail(criterion, value),
      };
    }
    return {
      criterion,
      met: false,
      detail:
        criterion.reason ??
        (criterion.kind === "instructor" ? "Needs an instructor's sign-off." : "Not available yet."),
    };
  });

  const levelMet = rows.every((r) => r.met);

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between">
          <h2 className="font-condensed text-xl font-bold text-ink">{LEVEL_NAMES[level]}</h2>
          {levelMet && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-leaf">
              <CircleCheck className="h-4 w-4" />
              Met
            </span>
          )}
        </div>
        <AccentBar className="mt-2" width="2rem" />
        <div className="mt-3 divide-y divide-gray-100">
          {rows.map(({ criterion, met, detail }) => (
            <CriterionRow
              key={criterion.id}
              label={criterion.label}
              detail={detail}
              met={met}
              muted={criterion.kind !== "auto"}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
