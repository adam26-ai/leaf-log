import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { DeviceKeys } from "@/components/settings/device-keys";
import { listDeviceTokens } from "@/lib/devices/repo";
import { requireProfile } from "@/lib/profile";

export const metadata = { title: "Devices — Leaf Log" };

export default async function DevicesPage() {
  const profile = await requireProfile();
  const tokens = await listDeviceTokens(profile.id);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Devices</SectionHeading>
        <p className="mt-3 mb-8 text-gray-600">
          Generate a scoped API key for each Leaf vario that should upload flights
          to your logbook.
        </p>

        <Card className="p-6">
          <DeviceKeys
            tokens={tokens.map((token) => ({
              id: token.id,
              label: token.label,
              deviceId: token.deviceId,
              createdAt: token.createdAt.toISOString(),
              lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
              revokedAt: token.revokedAt?.toISOString() ?? null,
            }))}
          />
        </Card>
      </main>
    </div>
  );
}
