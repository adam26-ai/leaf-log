"use client";

import { useActionState, useState } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { witnessCriterion, type SignoffState } from "@/app/flights/[id]/signoff-actions";
import type { RatingCriterion, RatingLevel } from "@/lib/ratings/criteria";

const initial: SignoffState = {};

function SignoffRow({ flightId, criterion, signed }: {
  flightId: string;
  criterion: RatingCriterion;
  signed: boolean;
}) {
  const action = witnessCriterion.bind(null, flightId);
  const [state, formAction, pending] = useActionState(action, initial);
  const [open, setOpen] = useState(false);

  if (signed || state.ok) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm">
        <CircleCheck className="h-4 w-4 shrink-0 text-leaf" />
        <span className="text-ink">{criterion.label}</span>
        <span className="text-xs text-gray-500">— signed off</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink">{criterion.label}</span>
        {!open && (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Mark witnessed
          </Button>
        )}
      </div>
      {open && (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="criterionKey" value={criterion.id} />
          <input
            type="text"
            name="note"
            maxLength={500}
            placeholder="Optional note (e.g. 3 consecutive landings within 10ft)"
            className="rounded-md border border-gray-300 bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Confirm sign-off"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Reachable only from a flight the viewer currently instructs. Lists every
 * `kind: "instructor"` criterion across P2/P3/P4 — a signed criterion shows
 * as done; an unsigned one gets a "Mark witnessed" action. Signing is
 * append-only and permanently attributed to the signer, independent of any
 * later reassignment (see lib/ratings/authz.ts::canWriteSignoff).
 */
export function SignoffForm({
  flightId,
  criteria,
  signedCriterionKeys,
}: {
  flightId: string;
  criteria: RatingCriterion[];
  signedCriterionKeys: Set<string>;
}) {
  const byLevel = new Map<RatingLevel, RatingCriterion[]>();
  for (const criterion of criteria) {
    if (criterion.kind !== "instructor") continue;
    const rows = byLevel.get(criterion.level) ?? [];
    rows.push(criterion);
    byLevel.set(criterion.level, rows);
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div>
          <h2 className="font-condensed text-lg font-bold text-ink">Sign off USHPA criteria</h2>
          <p className="mt-1 text-sm text-gray-600">
            As this flight&apos;s instructor, mark any skills you witnessed the pilot demonstrate.
            This updates their Ratings page and is permanently attributed to you.
          </p>
        </div>
        {Array.from(byLevel.entries()).map(([level, rows]) => (
          <div key={level} className="flex flex-col divide-y divide-gray-100">
            <h3 className="pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">
              {level}
            </h3>
            {rows.map((criterion) => (
              <SignoffRow
                key={criterion.id}
                flightId={flightId}
                criterion={criterion}
                signed={signedCriterionKeys.has(criterion.id)}
              />
            ))}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
