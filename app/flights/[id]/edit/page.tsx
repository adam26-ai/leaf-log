import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/profile";
import { getFlightForViewer } from "@/lib/flights/repo";
import { formatLocalDate, formatLocalTime } from "@/lib/flights/format";
import { formatLocationLabel } from "@/lib/sites/display";
import { AppHeader } from "@/components/app-header";
import { FlightEditSections } from "@/components/flight/flight-edit-sections";
import { AccentBar } from "@/components/ui/accent-bar";

export default async function EditFlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getCurrentProfile();
  if (!viewer) notFound();
  const flight = await getFlightForViewer(id, viewer.id);
  if (!flight || flight.ownerId !== viewer.id) notFound();

  const location =
    formatLocationLabel(flight.takeoffSiteName, flight.takeoffZoneName) ?? "Unknown site";
  const date = formatLocalDate(
    flight.takeoffAt ?? flight.flightDate,
    flight.localUtcOffsetMinutes,
  );
  const timeRange = `${formatLocalTime(flight.takeoffAt, flight.localUtcOffsetMinutes)} – ${formatLocalTime(flight.landingAt, flight.localUtcOffsetMinutes)}`;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={viewer} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="flex items-start gap-3">
          <Link
            href={`/flights/${flight.id}`}
            aria-label="Return to flight"
            title="Return to flight"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-paper text-gray-600 shadow-sm transition-colors hover:border-gray-400 hover:text-ink"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="font-condensed font-bold tracking-tight text-ink">Edit Flight</h1>
            <AccentBar className="bg-[var(--replay-accent)]" />
          </div>
        </div>
        <p className="mt-3 mb-8 font-condensed text-base text-gray-600">
          <span className="font-bold text-ink">{date} · {timeRange}</span>
          <span className="mx-2 text-gray-300" aria-hidden="true">|</span>
          {location}
        </p>
        <FlightEditSections flight={flight} />
      </main>
    </div>
  );
}
