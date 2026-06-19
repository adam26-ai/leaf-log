"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteFlight } from "@/app/flights/[id]/delete-action";

/** Owner-only delete with a low-key two-step inline confirm (no scary modal). */
export function DeleteFlightButton({ flightId }: { flightId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete flight
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">Delete this flight for good?</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => deleteFlight(flightId))}
      >
        {pending ? "Deleting…" : "Yes, delete"}
      </Button>
    </div>
  );
}
