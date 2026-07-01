"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Cable, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { claimDeviceAction } from "@/app/settings/devices/actions";

export function DevicePairingForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const code = String(formData.get("code") ?? "");
    const label = String(formData.get("label") ?? "");

    setError("");
    setConnected(false);
    startTransition(() => {
      void (async () => {
        const result = await claimDeviceAction(code, label);
        if (result.error) {
          setError(result.error);
          return;
        }
        form.reset();
        setConnected(true);
        router.refresh();
      })();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-condensed text-lg font-bold text-ink">
          Enter pairing code
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Type the code shown on your Leaf. The device will receive its upload token
          automatically.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Pairing code
        </span>
        <input
          name="code"
          required
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABC-DEF"
          className="h-11 rounded-md border border-gray-300 bg-paper px-3 font-mono text-base uppercase text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-condensed text-sm font-bold tracking-wide text-ink">
          Device name
        </span>
        <input
          name="label"
          maxLength={60}
          placeholder="Leaf vario"
          className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Cable className="h-4 w-4" />
          )}
          {pending ? "Connecting..." : "Connect Leaf"}
        </Button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {connected && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-leaf">
            <Check className="h-4 w-4" />
            Your Leaf is connected.
          </span>
        )}
      </div>
    </form>
  );
}
