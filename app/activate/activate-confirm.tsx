"use client";

import { FormEvent, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Cable, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { claimDeviceAction } from "@/app/settings/devices/actions";

/** One-tap "Connect this Leaf" confirm for the /activate landing (signed-in pilot). */
export function ActivateConfirm({
  code,
  displayName,
}: {
  code: string;
  displayName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = String(new FormData(event.currentTarget).get("label") ?? "");
    setError("");
    startTransition(() => {
      void (async () => {
        const result = await claimDeviceAction(code, label);
        if (result.error) setError(result.error);
        else setConnected(true);
      })();
    });
  }

  if (connected) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-leaf/15 text-leaf-strong">
          <Check className="h-6 w-6" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-condensed text-lg font-bold text-ink">
            Your Leaf is connected
          </p>
          <p className="text-sm text-gray-600">
            Your device screen will show &ldquo;Connected&rdquo; in a moment. New
            flights will upload to your logbook automatically.
          </p>
        </div>
        <Button asChild size="lg" variant="outline">
          <Link href="/logbook">Go to my logbook</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-center text-gray-600">
        Connect this Leaf to <span className="font-bold text-ink">{displayName}</span>
        &rsquo;s logbook.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Device name <span className="font-normal text-gray-400">(optional)</span>
        </span>
        <input
          name="label"
          maxLength={60}
          placeholder="My Leaf"
          className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
        />
      </label>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Cable className="h-4 w-4" />
        )}
        {pending ? "Connecting…" : "Connect this Leaf"}
      </Button>
      {error && (
        <p className="text-center text-sm text-red-600">
          {error} Start the connection again on your Leaf for a fresh code.
        </p>
      )}
    </form>
  );
}
