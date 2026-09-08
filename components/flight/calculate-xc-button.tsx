"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Waypoints } from "lucide-react";
import { queueFlightXc } from "@/lib/flights/queue-xc-action";

export function CalculateXcButton({ flightId }: { flightId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();
  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" disabled={pending} onClick={async e => {
      e.preventDefault(); e.stopPropagation();
      setPending(true); setError(undefined);
      try {
        const result = await queueFlightXc(flightId);
        if (result.error) setError(result.error);
        else router.refresh();
      } catch { setError("Couldn't queue scoring. Try again."); }
      finally { setPending(false); }
    }} className="inline-flex items-center gap-1 rounded-full border border-brand-blue/40 bg-white/90 px-2 py-1 text-xs font-medium text-brand-blue-strong disabled:opacity-60">
      <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />{pending ? "Calculating…" : "Calculate XC"}
    </button>
    {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
  </span>;
}
