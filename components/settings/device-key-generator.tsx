"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clipboard, KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateDeviceKeyAction } from "@/app/settings/devices/actions";

export function DeviceKeyGenerator({
  defaultLabel = "",
  defaultDeviceId = "",
}: {
  defaultLabel?: string;
  defaultDeviceId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const label = String(formData.get("label") ?? "");
    const deviceId = String(formData.get("device_id") ?? "");

    setError("");
    setCopied(false);
    setBusy(true);
    startTransition(() => {
      void (async () => {
        const result = await generateDeviceKeyAction(label, deviceId);
        setBusy(false);
        if (result.error) {
          setError(result.error);
          return;
        }
        setPlaintext(result.plaintext ?? null);
        router.refresh();
      })();
    });
  }

  async function copyKey() {
    if (!plaintext) return;
    await navigator.clipboard.writeText(plaintext);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="font-condensed text-sm font-bold tracking-wide text-ink">
            Device name
          </span>
          <input
            name="label"
            required
            maxLength={60}
            defaultValue={defaultLabel}
            placeholder="Leaf vario"
            className="h-11 rounded-md border border-gray-300 bg-paper px-3 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="font-condensed text-sm font-bold tracking-wide text-ink">
            Device ID
          </span>
          <input
            name="device_id"
            maxLength={120}
            defaultValue={defaultDeviceId}
            placeholder="Optional"
            className="h-11 rounded-md border border-gray-300 bg-paper px-3 font-mono text-sm text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending || busy}>
            <KeyRound className="h-4 w-4" />
            {pending || busy ? "Generating..." : "Generate device key"}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      {plaintext && (
        <div className="rounded-md border border-amber/50 bg-amber/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="font-condensed text-base font-bold text-ink">
                Copy it now
              </h3>
              <p className="text-sm text-gray-700">
                You won&apos;t be able to see this key again after you dismiss it.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPlaintext(null)}
              aria-label="Dismiss device key"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-paper px-3 py-2 font-mono text-sm text-ink">
              {plaintext}
            </code>
            <Button type="button" variant="ink" onClick={copyKey}>
              {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
