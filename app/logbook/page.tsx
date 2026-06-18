import Link from "next/link";
import { requireProfile } from "@/lib/profile";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export default async function LogbookPage() {
  const profile = await requireProfile();

  // Phase 4 fills in the flight list + stats. For now: a friendly empty state.
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <SectionHeading as="h1">
          {profile.display_name}&apos;s logbook
        </SectionHeading>

        <Card className="mt-8">
          <CardBody className="flex flex-col items-center gap-4 py-14 text-center">
            <p className="font-condensed text-2xl font-bold text-ink">
              No flights yet
            </p>
            <p className="max-w-md text-gray-600">
              Upload your first IGC file and watch your flight come to life —
              track map, barograph, and all your numbers.
            </p>
            <Button asChild size="lg">
              <Link href="/upload">Upload your first flight</Link>
            </Button>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
