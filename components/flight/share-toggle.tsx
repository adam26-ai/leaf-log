import { Lock, Users, Globe, type LucideIcon } from "lucide-react";
import type { FlightVisibility } from "@/lib/flights/visibility";

const ICONS: Record<FlightVisibility, LucideIcon> = {
  private: Lock,
  friends: Users,
  public: Globe,
};

const LABELS: Record<FlightVisibility, string> = {
  private: "Private — only you can see this flight",
  friends: "Friends only — visible to pilots you're friends with",
  public: "Public — anyone with the link can see this flight",
};

/** Read-only visibility indicator (owner only). Editing moves to a future
 *  flight-edit page rather than living inline here. */
export function ShareToggle({ visibility }: { visibility: FlightVisibility }) {
  const Icon = ICONS[visibility];
  return (
    <div className="inline-flex items-center gap-1.5 text-gray-600" title={LABELS[visibility]}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{LABELS[visibility]}</span>
    </div>
  );
}
