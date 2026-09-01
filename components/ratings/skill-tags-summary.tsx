import { Card, CardBody } from "@/components/ui/card";
import { AccentBar } from "@/components/ui/accent-bar";
import { SKILL_TAG_KEYS, SKILL_TAG_LABELS } from "@/lib/ratings/skill-tags";
import type { RatingStats } from "@/lib/ratings/stats";

/**
 * Self-reported Flight-type/Launch-type/Landing tags, tallied across the
 * pilot's own flights. Deliberately separate from the P2/P3/P4 cards above —
 * these tags are supporting context for a conversation with an instructor,
 * never proof of a verified USHPA Special Skill on their own.
 */
export function SkillTagsSummary({ stats }: { stats: RatingStats }) {
  const tagged = SKILL_TAG_KEYS.filter((key) => stats.skillTagCounts[key] > 0);

  return (
    <Card>
      <CardBody>
        <h2 className="font-condensed text-xl font-bold text-ink">Self-reported flight tags</h2>
        <AccentBar className="mt-2" width="2rem" />
        <p className="mt-3 text-sm text-gray-600">
          Flight type, Launch type, and Landing tags you&apos;ve logged on individual flights.
          These are your own record-keeping — none of USHPA&apos;s Special Skills count as
          verified until an instructor signs off on them.
        </p>
        {tagged.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">
            No flights tagged yet — add Flight type, Launch type, or Landing details from a
            flight&apos;s edit page.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {tagged.map((key) => (
              <span
                key={key}
                className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600"
              >
                {SKILL_TAG_LABELS[key]} ({key}) — {stats.skillTagCounts[key]} flight
                {stats.skillTagCounts[key] === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
