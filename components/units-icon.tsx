import { Ruler, UserRound } from "lucide-react";
import type { UnitMode } from "@/lib/flights/units";

export function UnitsIcon({ mode }: { mode: UnitMode }) {
  return <span className="relative inline-flex h-6 w-6 items-start justify-start" aria-hidden="true">
    <Ruler className="h-[18px] w-[18px]" />
    <span className="absolute -right-0.5 -bottom-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-gray-100 px-px text-[9px] font-bold leading-none">
      {mode === "custom" ? <UserRound className="h-3 w-3" /> : mode === "imperial" ? "ft" : "m"}
    </span>
  </span>;
}
