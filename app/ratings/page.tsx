import { requireProfile } from "@/lib/profile";
import { listOwnFlights } from "@/lib/flights/repo";
import { ratingStatsFrom } from "@/lib/ratings/stats";
import { criteriaForLevel, type RatingLevel } from "@/lib/ratings/criteria";
import { AppHeader } from "@/components/app-header";
import { RatingLevelCard } from "@/components/ratings/rating-level-card";
import { SkillTagsSummary } from "@/components/ratings/skill-tags-summary";

const LEVELS: RatingLevel[] = ["P2", "P3", "P4"];

export default async function RatingsPage() {
  const profile = await requireProfile();
  const flights = await listOwnFlights(profile.id);
  const stats = ratingStatsFrom(flights);

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
            />
          ))}
          <SkillTagsSummary stats={stats} />
        </div>
      </main>
    </div>
  );
}
