"use client";

import { useState } from "react";
import type { FlightFlag } from "@/lib/flights/type-flags";
import type { EntryOptions } from "@/lib/logbook/options";
import { ManualEntryForm } from "@/components/logbook/manual-entry-form";
import { Dropzone } from "./dropzone";

export function AddFlightForm({ options, imperial }: { options: EntryOptions; imperial: boolean }) {
  const [types, setTypes] = useState<{ flags: FlightFlag[]; tandemTouched: boolean }>({ flags: [], tandemTouched: false });
  return <>
    <Dropzone flags={types.flags} tandemTouched={types.tandemTouched} />
    <section className="mt-10 border-t border-gray-200 pt-8">
      <h2 className="mb-5 font-condensed text-2xl font-bold text-ink">Or manually enter flight details</h2>
      <ManualEntryForm options={options} imperial={imperial} onFlightTypesChange={(flags, tandemTouched) => setTypes({ flags, tandemTouched })} />
    </section>
  </>;
}
