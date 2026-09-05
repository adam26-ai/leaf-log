import { CircleCheck } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { AccentBar } from "@/components/ui/accent-bar";
import { CriterionRow } from "@/components/ratings/criterion-row";
import type { RatingCriterion, RatingLevel } from "@/lib/ratings/criteria";
import type { RatingStats } from "@/lib/ratings/stats";
import type { SignoffView } from "@/lib/ratings/signoffs";

const LEVEL_NAMES: Record<RatingLevel, string> = {
  P2: "P2 — Novice",
  P3: "P3 — Intermediate",
  P4: "P4 — Advanced",
};

const SIGNED_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDetail(criterion: RatingCriterion, value: number): string {
  const shown = criterion.unit === "hours" ? value.toFixed(1) : String(Math.round(value));
  const base = `${shown} / ${criterion.required}`;
  return criterion.unit ? `${base} ${criterion.unit}` : base;
}

/**
 * One P2/P3/P4 card. An `auto` row reads its live value straight off
 * `RatingStats`. An `instructor` row is "met" the moment ANY active
 * RatingSignoff exists for that criterion — one witnessed sign-off
 * satisfies the whole row, not a count against `required` (see
 * RatingSignoff's doc comment in prisma/schema.prisma). A `future` row is
 * always greyed with its own specific reason.
 */
export function RatingLevelCard({
  level,
  criteria,
  stats,
  signoffs,
}: {
  level: RatingLevel;
  criteria: RatingCriterion[];
  stats: RatingStats;
  signoffs: SignoffView[];
}) {
  const rows = criteria.map((criterion) => {
    if (criterion.kind === "auto") {
      const value = criterion.getValue!(stats);
      return {
        criterion,
        met: value >= criterion.required,
        detail: formatDetail(criterion, value),
        muted: false,
      };
    }

    if (criterion.kind === "instructor") {
      const signoff = signoffs.find((s) => s.criterionKey === criterion.id);
      if (signoff) {
        return {
          criterion,
          met: true,
          detail: `Signed off by ${signoff.signedByDisplayName} on ${SIGNED_DATE_FORMAT.format(signoff.signedAt)}`,
          muted: false,
        };
      }
    }

    return {
      criterion,
      met: false,
      detail:
        criterion.reason ??
        (criterion.kind === "instructor" ? "Needs an instructor's sign-off." : "Not available yet."),
      muted: true,
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
          {rows.map(({ criterion, met, detail, muted }) => (
            <CriterionRow
              key={criterion.id}
              label={criterion.label}
              detail={detail}
              met={met}
              muted={muted}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
