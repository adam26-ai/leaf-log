"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revokeDeviceKeyAction } from "@/app/settings/devices/actions";
import { DeviceKeyGenerator } from "./device-key-generator";

export interface DeviceTokenView {
  id: string;
  label: string;
  deviceId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function DeviceKeys({ tokens }: { tokens: DeviceTokenView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function revoke(id: string) {
    setError("");
    setRevokingId(id);
    startTransition(() => {
      void (async () => {
        const result = await revokeDeviceKeyAction(id);
        setRevokingId(null);
        if (result.error) setError(result.error);
        else router.refresh();
      })();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <DeviceKeyGenerator />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-condensed text-lg font-bold text-ink">Device keys</h2>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
        {tokens.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-600">
            No device keys yet.
          </p>
        ) : (
          <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {tokens.map((token) => {
              const revoked = Boolean(token.revokedAt);
              const isPending = pending && revokingId === token.id;
              return (
                <div
                  key={token.id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-condensed text-base font-bold text-ink">
                        {token.label}
                      </h3>
                      {revoked && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-600">
                          Revoked
                        </span>
                      )}
                    </div>
                    <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm text-gray-600 sm:grid-cols-3">
                      <div>
                        <dt className="sr-only">Device ID</dt>
                        <dd className="truncate font-mono">
                          {token.deviceId || "No device ID"}
                        </dd>
                      </div>
                      <div>
                        <dt className="sr-only">Created</dt>
                        <dd>Created {formatDate(token.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Last used</dt>
                        <dd>Last used {formatDate(token.lastUsedAt)}</dd>
                      </div>
                    </dl>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revoked || isPending}
                    onClick={() => revoke(token.id)}
                  >
                    {isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Ban className="h-4 w-4" />
                    )}
                    Revoke
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
