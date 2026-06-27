import { requireProfile } from "@/lib/profile";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Card } from "@/components/ui/card";
import { RELEASE_NOTES } from "@/lib/whats-new";

export const metadata = { title: "What's new — Leaf Log" };

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function WhatsNewPage() {
  const profile = await requireProfile();
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <SectionHeading as="h1">What&apos;s new</SectionHeading>
        <p className="mt-3 mb-8 text-gray-600">
          The latest features rolled out to Leaf Log.
        </p>

        <ol className="flex flex-col gap-4">
          {RELEASE_NOTES.map((note) => (
            <li key={`${note.date}-${note.title}`}>
              <Card className="flex flex-col gap-2 p-6">
                <time className="font-condensed text-xs font-bold tracking-wide text-amber-strong uppercase">
                  {formatDate(note.date)}
                </time>
                <h2 className="font-condensed text-lg font-bold text-ink">
                  {note.title}
                </h2>
                <p className="text-gray-600">{note.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
