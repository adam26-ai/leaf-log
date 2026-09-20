"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteRevokedDeviceKeyAction, restoreDeviceKeyAction, revokeDeviceKeyAction } from "@/app/settings/devices/actions";
import { formatDuration } from "@/lib/flights/format";

export interface DeviceTokenView {
  id: string;
  label: string;
  deviceId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  lastFlight: {
    id: string;
    status: string;
    flightDate: string | null;
    takeoffAt: string | null;
    takeoffSiteName: string | null;
    durationS: number | null;
  } | null;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function flightSummary(flight: NonNullable<DeviceTokenView["lastFlight"]>): string {
  const when = flight.takeoffAt ?? flight.flightDate;
  const date = when
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(when),
      )
    : "Undated flight";
  const duration = flight.durationS == null ? null : formatDuration(flight.durationS);
  return [date, flight.takeoffSiteName, duration]
    .filter(Boolean)
    .join(" · ");
}

export function DeviceKeys({ tokens }: { tokens: DeviceTokenView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [changingId, setChangingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "delete" | "revoke" } | null>(null);
  const [error, setError] = useState("");

  function revoke(id: string) {
    setError("");
    setChangingId(id);
    startTransition(() => {
      void (async () => {
        const result = await revokeDeviceKeyAction(id);
        setChangingId(null);
        if (result.error) setError(result.error);
        else router.refresh();
      })();
    });
  }

  function remove(id: string) {
    setError("");
    setChangingId(id);
    startTransition(() => {
      void (async () => {
        const result = await deleteRevokedDeviceKeyAction(id);
        setChangingId(null);
        if (result.error) setError(result.error);
        else router.refresh();
      })();
    });
  }

  function restore(id: string) {
    setError("");
    setConfirming(null);
    setChangingId(id);
    startTransition(() => {
      void (async () => {
        const result = await restoreDeviceKeyAction(id);
        setChangingId(null);
        if (result.error) setError(result.error);
        else router.refresh();
      })();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-condensed text-lg font-bold text-ink">
            Connected devices
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">
            Active devices are shown in green. Revoke a device to stop it from uploading; you can reinstate it later. Delete permanently removes a revoked device from your account.
          </p>
        </div>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {tokens.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-600">
          No connected devices yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map((token) => {
            const revoked = Boolean(token.revokedAt);
            const isPending = pending && changingId === token.id;
            return (
              <div
                key={token.id}
                style={revoked ? undefined : { backgroundColor: "rgb(148 233 30 / 0.38)" }}
                className={`relative rounded-md border border-gray-200 p-4 ${confirming?.id === token.id ? "pr-44" : "pr-28"} ${revoked ? "bg-gray-50" : ""}`}
              >
                <div className={`min-w-0 ${revoked ? "opacity-60" : ""}`}>
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
                  <dl className={`mt-1 grid gap-x-4 gap-y-1 text-sm text-gray-600 ${confirming?.id === token.id ? "grid-cols-1" : "sm:grid-cols-2"}`}>
                    <div>
                      <dt className="sr-only">Created</dt>
                      <dd>Created {formatDate(token.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="sr-only">Last used</dt>
                      <dd>Last used {formatDate(token.lastUsedAt)}</dd>
                    </div>
                  </dl>
                  <div className="mt-2 text-sm text-gray-600">
                    {token.lastFlight ? (
                      <>
                        Latest flight{" "}
                        <Link
                          href={`/flights/${token.lastFlight.id}`}
                          className="font-medium text-ink underline decoration-gray-300 underline-offset-2"
                        >
                          {flightSummary(token.lastFlight)}
                        </Link>
                      </>
                    ) : (
                      "No flights uploaded with this key."
                    )}
                  </div>
                </div>
                <div className="absolute right-3 top-3 flex items-center gap-1.5">
                  {revoked ? (
                    confirming?.id === token.id && confirming.action === "delete" ? (
                      <div className="flex flex-col items-stretch gap-1">
                        <Button type="button" variant="danger" size="sm" disabled={isPending} onClick={() => remove(token.id)}>
                          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Confirm delete
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirming(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <>
                        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 px-0 text-gray-500" aria-label={`Delete ${token.label}`} title="Delete device" disabled={isPending} onClick={() => setConfirming({ id: token.id, action: "delete" })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 px-0 text-gray-500" aria-label={`Reinstate ${token.label}`} title="Reinstate device" disabled={isPending} onClick={() => restore(token.id)}>
                          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        </Button>
                      </>
                    )
                  ) : confirming?.id === token.id && confirming.action === "revoke" ? (
                    <div className="flex flex-col items-stretch gap-1">
                      <Button type="button" variant="danger" size="sm" disabled={isPending} onClick={() => revoke(token.id)}>
                        {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                        Confirm revoke
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirming(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="h-9 w-9 px-0 text-gray-500" aria-label={`Revoke ${token.label}`} title="Revoke device" disabled={isPending} onClick={() => setConfirming({ id: token.id, action: "revoke" })}>
                      <Ban className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
