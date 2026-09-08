"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Waypoints } from "lucide-react";
import { queueFlightXc, queueMissingFlightAnalysis } from "@/lib/flights/queue-xc-action";

export function CalculateXcButton({ flightId, kind, label = "Calculate XC", subtle = false, inline = false }: { flightId?: string; kind?: "xc" | "repair"; label?: string; subtle?: boolean; inline?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();
  return <span className={inline ? "relative inline-flex min-w-0" : "inline-flex flex-col items-start gap-1"}>
    <button type="button" disabled={pending} onClick={async e => {
      e.preventDefault(); e.stopPropagation();
      setPending(true); setError(undefined);
      try {
        const result = kind ? await queueMissingFlightAnalysis(kind) : await queueFlightXc(flightId!);
        if (result.error) setError(result.error);
        else router.refresh();
      } catch { setError("Couldn't queue scoring. Try again."); }
      finally { setPending(false); }
    }} className={inline ? "h-5 truncate rounded-full border border-brand-blue/40 bg-white/90 px-2 text-xs font-medium text-brand-blue-strong disabled:opacity-60" : subtle ? "rounded-full px-1 text-[11px] text-gray-500 underline decoration-gray-300 underline-offset-4 hover:text-brand-blue-strong disabled:opacity-60" : "inline-flex items-center gap-1 rounded-full border border-brand-blue/40 bg-white/90 px-2 py-1 text-xs font-medium text-brand-blue-strong disabled:opacity-60"}>
      {!subtle && !inline && <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />}{pending ? "Queueing…" : label}
    </button>
    {error && <span role="alert" className={inline ? "absolute left-0 top-full z-50 mt-2 w-56 max-w-[80vw] rounded-xl border border-red-200 bg-white p-3 text-xs text-red-600 shadow-lg" : "text-xs text-red-600"}>{error}</span>}
  </span>;
}
