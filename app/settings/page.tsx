import { requireProfile } from "@/lib/profile";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { RainCloudIcon } from "@/components/icons/rain-cloud-icon";
import { signOutAction } from "@/lib/actions";
import { AppHeader } from "@/components/app-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { DevicesSettingsCard } from "@/components/settings/devices-settings-card";
import { SettingsForm } from "./settings-form";
import { WingEditor } from "./wing-editor";
import { listOwnWings } from "@/lib/flights/wings";
import { listDeviceTokens } from "@/lib/devices/repo";
import { listOwnFlightsByIds } from "@/lib/flights/repo";

export const metadata = { title: "Settings — Leaf Log" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  const [wings, tokens] = await Promise.all([
    listOwnWings(profile.id),
    listDeviceTokens(profile.id),
  ]);
  const latestFlights = await listOwnFlightsByIds(
    profile.id,
    tokens.flatMap((token) => (token.lastFlightId ? [token.lastFlightId] : [])),
  );
  const latestFlightById = new Map(latestFlights.map((flight) => [flight.id, flight]));
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <SectionHeading as="h1">Profile &amp; settings</SectionHeading>
          <Link
            href="/whats-new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-brand-blue hover:text-brand-blue-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            What&apos;s new
          </Link>
        </div>

        <div className="mt-8 flex flex-col gap-6">
            <SettingsForm
              handle={profile.handle}
              displayName={profile.displayName}
              avatarUpdatedAt={profile.avatarUpdatedAt}
              bio={profile.bio ?? ""}
              defaultVisibility={profile.defaultVisibility}
              defaultUnits={profile.defaultUnits}
              customUnits={profile.customUnits}
              mapDefaults={profile.mapDefaults}
              ratingsTrackingEnabled={profile.ratingsTrackingEnabled}
              afterProfile={<WingEditor wings={wings} tandemEnabled={profile.tandemEnabled} collapsible />}
            />
          <DevicesSettingsCard
            tokens={tokens.map((token) => {
              const lastFlight = token.lastFlightId
                ? latestFlightById.get(token.lastFlightId)
                : null;
              return {
                id: token.id,
                label: token.label,
                deviceId: token.deviceId,
                createdAt: token.createdAt.toISOString(),
                lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
                revokedAt: token.revokedAt?.toISOString() ?? null,
                lastFlight: lastFlight
                  ? {
                      id: lastFlight.id,
                      status: lastFlight.status,
                      flightDate: lastFlight.flightDate?.toISOString() ?? null,
                      takeoffAt: lastFlight.takeoffAt?.toISOString() ?? null,
                      takeoffSiteName: lastFlight.takeoffSiteName,
                      durationS: lastFlight.durationS,
                    }
                  : null,
              };
            })}
          />

        </div>
        <form action={signOutAction} className="mt-8 flex justify-center">
          <button type="submit" className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
            <RainCloudIcon aria-hidden="true" className="h-6 w-6" />
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}
