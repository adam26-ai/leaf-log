import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { DeviceKeys } from "@/components/settings/device-keys";
import { DevicePairingForm } from "@/components/settings/device-pairing-form";
import { listDeviceTokens } from "@/lib/devices/repo";
import { listOwnFlightsByIds } from "@/lib/flights/repo";
import { requireProfile } from "@/lib/profile";

export const metadata = { title: "Devices — Leaf Log" };

export default async function DevicesPage() {
  const profile = await requireProfile();
  const tokens = await listDeviceTokens(profile.id);
  const latestFlights = await listOwnFlightsByIds(
    profile.id,
    tokens.flatMap((token) => (token.lastFlightId ? [token.lastFlightId] : [])),
  );
  const latestFlightById = new Map(
    latestFlights.map((flight) => [flight.id, flight]),
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <SectionHeading as="h1">Devices</SectionHeading>
        <p className="mt-3 mb-8 text-gray-600">
          Connect your Leaf vario by entering the pairing code shown on the
          device. Upload credentials stay on the device.
        </p>

        <Card className="flex flex-col gap-8 p-6">
          <DevicePairingForm />
          <DeviceKeys
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
        </Card>
      </main>
    </div>
  );
}
