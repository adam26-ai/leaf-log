import { requireProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { AppHeader } from "@/components/app-header";
import { flightTrophies } from "@/lib/flights/trophies";
import { listEditorFlights } from "@/lib/logbook/bulk-edit";
import { getEntryOptions } from "@/lib/logbook/options";
import { AdvancedLogbook } from "@/components/logbook/advanced-logbook";
import css from "@/components/logbook/advanced-logbook.module.css";

export default async function AdvancedLogbookPage() {
  const profile = await requireProfile();
  const [flights, options, graph] = await Promise.all([
    listEditorFlights(profile.id), getEntryOptions(profile.id),
    prisma.friendship.findMany({ where: { status: "accepted", OR: [{ requesterId: profile.id }, { addresseeId: profile.id }] }, include: { requester: { select: { id: true, displayName: true } }, addressee: { select: { id: true, displayName: true } } } }),
  ]);
  const instructors = graph.map(edge => edge.requesterId === profile.id ? edge.addressee : edge.requester);
  return <div className={css.page}>
    <div className={css.navigation} data-editor-navigation><AppHeader profile={profile} /></div>
    <AdvancedLogbook initialFlights={flights} ownerId={profile.id} displayName={profile.displayName} options={options} instructors={instructors} trophies={flightTrophies(flights.map(flight => flight.list))} />
  </div>;
}
