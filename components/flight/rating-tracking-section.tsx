import type { Flight } from "@prisma/client";
import { getProfileById } from "@/lib/profile";
import { listFriends } from "@/lib/social/friends";
import {
  FlightDetailsEditor,
  type FlightDetails,
} from "@/app/flights/[id]/edit/flight-details-editor";
import {
  InstructorEditor,
  type InstructorOption,
} from "@/app/flights/[id]/edit/instructor-editor";

/**
 * Everything that feeds a pilot's USHPA ratings progress, aggregated into
 * one section: self-reported Flight details (Occupancy/Flight type/Launch
 * type/Landing) and Instructor assignment. Two independent forms/saves
 * (different server actions, different authz) sharing one visual area —
 * gated behind Profile.ratingsTrackingEnabled, see FlightEditSections.
 */
export async function RatingTrackingSection({ flight }: { flight: Flight }) {
  const friends = await listFriends(flight.ownerId);
  const instructorOptions: InstructorOption[] = friends.map((f) => ({
    id: f.id,
    displayName: f.displayName,
    handle: f.handle,
  }));
  if (flight.instructorId && !instructorOptions.some((o) => o.id === flight.instructorId)) {
    const stale = await getProfileById(flight.instructorId);
    if (stale) {
      instructorOptions.push({
        id: stale.id,
        displayName: stale.displayName,
        handle: stale.handle,
        stale: true,
      });
    }
  }

  const details: FlightDetails = {
    occupancy: flight.occupancy,
    flightTypeTags: flight.flightTypeTags,
    launchTypes: flight.launchTypes,
    restrictedLandingField: flight.restrictedLandingField,
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase">
          Flight details
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Tandem flights are excluded from solo airtime; the rest show up as self-reported tallies
          on your Ratings page.
        </p>
        <div className="mt-3">
          <FlightDetailsEditor flightId={flight.id} details={details} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase">Instructor</h3>
        <p className="mt-1 text-sm text-gray-600">
          Name an accepted friend as this flight&apos;s instructor of record — they aren&apos;t
          notified, and this is what lets them leave notes and sign off USHPA skills here.
        </p>
        <div className="mt-3">
          <InstructorEditor
            flightId={flight.id}
            options={instructorOptions}
            instructorId={flight.instructorId}
          />
        </div>
      </div>
    </div>
  );
}
