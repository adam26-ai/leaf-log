import { Eye, FilePenLine, GraduationCap, Images, StickyNote, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Flight } from "@prisma/client";
import { normalizeVisibility } from "@/lib/flights/visibility";
import { Card } from "@/components/ui/card";
import { VisibilityEditor } from "./visibility-editor";
import { DeleteFlightButton } from "./delete-flight-button";
import { NotesEditor } from "@/app/flights/[id]/edit/notes-editor";
import { PhotosSection } from "@/app/flights/[id]/edit/photos-section";
import { FlightWingEditor } from "@/app/flights/[id]/edit/wing-editor";
import { RecordingDetails } from "./recording-details";
import { getIgcDetailsOptions } from "@/lib/flights/igc-details";
import { isLogbookEntry } from "@/lib/flights/recording";
import { getEntryOptions } from "@/lib/logbook/options";
import { flightToEntryDraft } from "@/lib/logbook/flight-draft";
import { ManualEntryForm } from "@/components/logbook/manual-entry-form";
import { AttachIgcForm } from "@/components/logbook/attach-igc-form";
import { RatingTrackingSection } from "./rating-tracking-section";

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-condensed text-lg font-bold text-ink">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--replay-metric-icon-bg)]">
        <Icon className="h-4 w-4 text-[var(--replay-icon)] [stroke-width:var(--replay-metric-icon-stroke)]" />
      </span>
      {children}
    </h2>
  );
}

export async function FlightEditSections({
  flight,
  ratingsTrackingEnabled,
}: {
  flight: Flight;
  ratingsTrackingEnabled: boolean;
}) {
  const options = isLogbookEntry(flight) ? { recording: null, gliders: [] } : await getIgcDetailsOptions(flight.ownerId, flight.id);
  const entryOptions = isLogbookEntry(flight) ? await getEntryOptions(flight.ownerId) : null;
  const cardClass = "flex flex-col gap-3 border-[var(--replay-inactive-border)] p-5";
  return (
    <div className="flex flex-col gap-4">
        {entryOptions ? <Card className={cardClass}>
          <SectionTitle icon={FilePenLine}>Flight details</SectionTitle>
          <ManualEntryForm options={entryOptions} initial={flightToEntryDraft(flight)} flightId={flight.id} expectedUpdatedAt={flight.updatedAt.toISOString()} defaultVisibility={flight.visibility} />
        </Card> : <>
        <Card className={cardClass}>
          <SectionTitle icon={FilePenLine}>Wing</SectionTitle>
          <FlightWingEditor flightId={flight.id} glider={flight.glider ?? ""} gliders={options.gliders} />
        </Card>
        {options.recording && <Card className={cardClass}><RecordingDetails details={options.recording} /></Card>}
        <Card className={cardClass}>
          <SectionTitle icon={Eye}>Visibility</SectionTitle>
          <VisibilityEditor flightId={flight.id} visibility={normalizeVisibility(flight.visibility)} />
        </Card>
        <Card className={cardClass}>
          <SectionTitle icon={StickyNote}>Notes</SectionTitle>
          <NotesEditor flightId={flight.id} notes={flight.notes ?? ""} />
        </Card>
        </>}
        {ratingsTrackingEnabled && (
          <Card className={cardClass}>
            <SectionTitle icon={GraduationCap}>Ratings tracking</SectionTitle>
            <RatingTrackingSection flight={flight} />
          </Card>
        )}
        {entryOptions && <Card className={cardClass}><SectionTitle icon={FilePenLine}>Attach an IGC recording</SectionTitle><AttachIgcForm flightId={flight.id} /></Card>}
        <Card className={cardClass}>
          <SectionTitle icon={Images}>Pictures</SectionTitle>
          <PhotosSection flightId={flight.id} />
        </Card>
        <Card className="flex flex-col gap-3 border-red-300 p-5">
          <SectionTitle icon={TriangleAlert}>Danger zone</SectionTitle>
          <p className="text-sm text-gray-600">
            Deleting a flight removes its track, statistics, and pictures permanently.
          </p>
          <div><DeleteFlightButton flightId={flight.id} /></div>
        </Card>
    </div>
  );
}
