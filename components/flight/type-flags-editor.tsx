"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlightTypeFields } from "./type-flags";
import { Button } from "@/components/ui/button";
import type { FlightFlag } from "@/lib/flights/type-flags";
import { saveFlightFlags } from "@/app/flights/[id]/edit/actions";

export function FlightTypeEditor({ flightId, initial }: { flightId: string; initial: FlightFlag[] }) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <div className="space-y-4">
    <FlightTypeFields value={value} onChange={next => { setValue(next); setMessage(""); }} disabled={pending} />
    <div className="flex items-center gap-3"><Button type="button" disabled={pending} onClick={() => startTransition(async () => {
      try {
        const result = await saveFlightFlags(flightId, value);
        setMessage(result.error ?? "Saved.");
        if (!result.error) router.refresh();
      } catch { setMessage("Could not save flight types. Please try again."); }
    })}>{pending ? "Saving…" : "Save flight type"}</Button><span role="status" className="text-sm text-gray-600">{message}</span></div>
  </div>;
}
