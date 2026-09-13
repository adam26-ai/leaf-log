"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSiteEditorAction, saveSiteEditorAction, type SiteEditorContext } from "@/app/settings/sites/editor-actions";
import { SiteEditor } from "./site-editor";
import { Button } from "@/components/ui/button";

export function PersistedSiteEditor({ context, initialName, onSaved, onCancel }: {
  context: SiteEditorContext; initialName?: string; onSaved: (site: { id: string; name: string }) => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof getSiteEditorAction>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { siteId, flightId, endpoint, create } = context;
  useEffect(() => {
    let cancelled = false;
    getSiteEditorAction({ siteId, flightId, endpoint, create }).then(result => { if (!cancelled) setData(result); })
      .catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load site details."); });
    return () => { cancelled = true; };
  }, [siteId, flightId, endpoint, create]);
  if (!data) return <><p role={error ? "alert" : "status"}>{error ?? "Loading site details…"}</p><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></>;
  return <SiteEditor initial={initialName === undefined ? data.initial : { ...data.initial, name: initialName }} pinSource={data.pinSource} flightPoint={data.flightPoint} canChangeVisibility={data.canChangeVisibility} usageCount={data.usageCount}
    onCancel={onCancel} onSave={async draft => {
      const site = await saveSiteEditorAction({ draft, context, expectedFlightRevision: data.expectedFlightRevision });
      router.refresh(); onSaved(site);
    }} />;
}
