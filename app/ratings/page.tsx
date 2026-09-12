import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { listOwnFlights } from "@/lib/flights/repo";
import { ratingStatsFrom } from "@/lib/ratings/stats";
import { criteriaForLevel, type RatingLevel } from "@/lib/ratings/criteria";
import { activeSignoffsFor } from "@/lib/ratings/signoffs";
import { AppHeader } from "@/components/app-header";
import { RatingLevelCard } from "@/components/ratings/rating-level-card";
import { SkillTagsSummary } from "@/components/ratings/skill-tags-summary";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LEVELS: RatingLevel[] = ["P2", "P3", "P4"];

export default async function RatingsPage() {
  const profile = await requireProfile();

  if (!profile.ratingsTrackingEnabled) {
    return (
      <div className="flex flex-1 flex-col">
        <AppHeader profile={profile} />
        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
          <h1 className="font-condensed text-3xl font-bold tracking-tight text-ink">
            Ratings progress
          </h1>
          <Card className="mt-8">
            <CardBody className="flex flex-col gap-3">
              <p className="text-gray-600">
                Ratings tracking is off. Turn it on in Settings to see your progress toward
                USHPA&apos;s P2, P3, and P4 ratings, tag flight details, and assign an instructor.
              </p>
              <div>
                <Button asChild>
                  <Link href="/settings">Go to Settings</Link>
                </Button>
              </div>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  const flights = await listOwnFlights(profile.id);
  const stats = ratingStatsFrom(flights);
  const signoffs = await activeSignoffsFor(profile.id, profile.id);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <h1 className="font-condensed text-3xl font-bold tracking-tight text-ink">
          Ratings progress
        </h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Your progress toward USHPA&apos;s P2, P3, and P4 ratings, calculated from your logged
          flights. Rows that need an instructor&apos;s sign-off or aren&apos;t trackable yet are
          shown greyed out with an explanation.
        </p>
        <div className="mt-8 flex flex-col gap-6">
          {LEVELS.map((level) => (
            <RatingLevelCard
              key={level}
              level={level}
              criteria={criteriaForLevel(level)}
              stats={stats}
              signoffs={signoffs.filter((s) => s.ratingLevel === level)}
            />
          ))}
          <SkillTagsSummary stats={stats} />
        </div>
      </main>
    </div>
  );
}
