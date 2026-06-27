import { requireProfile } from "@/lib/profile";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Card } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";
import { AvatarUploader } from "./avatar-uploader";

export const metadata = { title: "Settings — Leaf Log" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Profile &amp; settings</SectionHeading>
        <p className="mt-3 mb-8 text-gray-600">
          How you show up to the community, and what happens to flights you upload.
        </p>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="font-condensed text-lg font-bold text-ink">Photo</h2>
            <AvatarUploader
              handle={profile.handle}
              displayName={profile.displayName}
              avatarUpdatedAt={profile.avatarUpdatedAt}
            />
          </Card>

          <Card className="p-6">
            <SettingsForm
              handle={profile.handle}
              displayName={profile.displayName}
              bio={profile.bio ?? ""}
              defaultVisibility={profile.defaultVisibility}
            />
          </Card>
        </div>
      </main>
    </div>
  );
}
