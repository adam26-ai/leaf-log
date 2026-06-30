"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cable, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeviceKeyGenerator } from "@/components/settings/device-key-generator";

interface PairPayload {
  email?: string;
  device?: string;
}

function decodePayload(): PairPayload {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = {
    email: params.get("email") || undefined,
    device: params.get("device") || undefined,
  };

  const fragment = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const fragmentParams = new URLSearchParams(fragment);
  const rawPayload = fragmentParams.get("payload");
  if (!rawPayload) return fromQuery;

  try {
    const normalized = rawPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
    const parsed = JSON.parse(window.atob(normalized)) as PairPayload;
    return {
      email: typeof parsed.email === "string" ? parsed.email : fromQuery.email,
      device: typeof parsed.device === "string" ? parsed.device : fromQuery.device,
    };
  } catch {
    return fromQuery;
  }
}

export function PairClient({
  signedIn,
  onboarded,
  displayName,
}: {
  signedIn: boolean;
  onboarded: boolean;
  displayName?: string;
}) {
  const [payload, setPayload] = useState<PairPayload>({});

  useEffect(() => {
    const id = window.setTimeout(() => setPayload(decodePayload()), 0);
    return () => window.clearTimeout(id);
  }, []);

  if (!signedIn) {
    return (
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber/20 text-ink">
          <Cable className="h-5 w-5" />
        </div>
        <h1 className="font-condensed text-3xl font-bold text-ink">
          Connect your Leaf to Leaf Log
        </h1>
        <p className="mt-3 text-gray-600">
          Sign in to generate a private device key. If your Leaf prefilled a
          device ID, it may not survive the email round-trip; you can name it
          manually after signing in.
        </p>
        <Button asChild size="lg" className="mt-6 w-full">
          <Link href="/sign-in?next=/pair">
            <LogIn className="h-4 w-4" />
            Sign in
          </Link>
        </Button>
      </Card>
    );
  }

  if (!onboarded) {
    return (
      <Card className="w-full max-w-md p-6 text-center">
        <h1 className="font-condensed text-3xl font-bold text-ink">
          Finish your profile
        </h1>
        <p className="mt-3 text-gray-600">
          Create your pilot profile before connecting a Leaf vario.
        </p>
        <Button asChild size="lg" className="mt-6 w-full">
          <Link href="/onboarding">Continue</Link>
        </Button>
      </Card>
    );
  }

  const device = payload.device?.trim() || "";
  return (
    <Card className="w-full max-w-xl p-6">
      <div className="mb-5 flex flex-col gap-2">
        <h1 className="font-condensed text-3xl font-bold text-ink">
          Connect this Leaf
        </h1>
        <p className="text-gray-600">
          Generate a key for {displayName ?? "your account"}, then copy it into
          the Leaf pilot profile.
        </p>
      </div>
      <DeviceKeyGenerator
        defaultLabel={device || "Leaf vario"}
        defaultDeviceId={device}
      />
    </Card>
  );
}
