"use client";

import { Plug } from "lucide-react";
import { CollapsibleSettingsCard } from "@/components/settings/collapsible-settings-card";
import { DeviceKeys, type DeviceTokenView } from "@/components/settings/device-keys";
import { DevicePairingForm } from "@/components/settings/device-pairing-form";

export function DevicesSettingsCard({ tokens }: { tokens: DeviceTokenView[] }) {
  return (
    <CollapsibleSettingsCard title="Devices" icon={<Plug className="h-6 w-6" aria-hidden="true" />}>
      <div className="flex flex-col gap-8">
        <p className="text-sm leading-relaxed text-gray-600">
          To pair your Leaf vario with Leaf Log, follow <a href="https://leafvario.com/user-manual/#leaf-log" target="_blank" rel="noreferrer" className="text-brand-blue-strong underline underline-offset-2">these instructions</a> on your Leaf.
        </p>
        <DeviceKeys tokens={tokens} />
        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-blue">Alternative pairing method</summary>
          <div className="border-t border-gray-200 p-4"><DevicePairingForm /></div>
        </details>
      </div>
    </CollapsibleSettingsCard>
  );
}
