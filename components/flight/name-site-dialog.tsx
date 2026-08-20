"use client";

import { useEffect, useState, useTransition } from "react";
import {
  nameSite,
  suggestSitesForFlight,
  getBoundSiteInfo,
  unpublishSiteForFlight,
  deleteSiteForFlight,
  type BoundSiteInfo,
} from "@/app/flights/[id]/site-action";
import type { SiteEndpoint } from "@/lib/sites/associate";
import type { SiteVisibility } from "@/lib/sites/visibility";
import type { SiteSuggestion } from "@/lib/sites/repo";
import { formatDistance, formatBearing } from "@/lib/flights/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Click-to-edit control for a flight's takeoff/landing site name. Owner-only
 * interactivity; other viewers just see the resolved name (or "Unknown
 * site") as plain text — the read-path firewall (lib/flights/repo.ts) is
 * what actually decides that name, this component just displays it.
 */
export function SiteNameControl({
  flightId,
  endpoint,
  initialName,
  isOwner,
  className,
  as: As = "span",
}: {
  flightId: string;
  endpoint: SiteEndpoint;
  initialName: string | null;
  isOwner: boolean;
  className?: string;
  as?: "h1" | "span";
}) {
  const [name, setName] = useState(initialName);
  const [open, setOpen] = useState(false);
  const label = name ?? "Unknown site";

  if (!isOwner) {
    return <As className={className}>{label}</As>;
  }

  return (
    <>
      <As>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            className,
            "cursor-pointer rounded-sm text-left underline decoration-dotted decoration-2 underline-offset-4 hover:decoration-solid",
          )}
          title={name ? "Rename this site" : "Name this site"}
        >
          {label}
        </button>
      </As>
      {open && (
        <NameSiteDialog
          flightId={flightId}
          endpoint={endpoint}
          currentName={name}
          onClose={() => setOpen(false)}
          onNamed={(result) => {
            setName(result.siteName);
            setOpen(false);
          }}
          onUndone={() => {
            setName(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

const ENDPOINT_LABEL: Record<SiteEndpoint, string> = {
  takeoff: "takeoff",
  landing: "landing",
};

function NameSiteDialog({
  flightId,
  endpoint,
  currentName,
  onClose,
  onNamed,
  onUndone,
}: {
  flightId: string;
  endpoint: SiteEndpoint;
  currentName: string | null;
  onClose: () => void;
  onNamed: (result: { siteId: string; siteName: string }) => void;
  onUndone: () => void;
}) {
  const [suggestions, setSuggestions] = useState<SiteSuggestion[] | null>(null);
  const [boundSite, setBoundSite] = useState<BoundSiteInfo | null>(null);
  const [name, setNameValue] = useState("");
  const [visibility, setVisibility] = useState<SiteVisibility>("public");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    suggestSitesForFlight(flightId, endpoint).then((rows) => {
      if (!cancelled) setSuggestions(rows);
    });
    getBoundSiteInfo(flightId, endpoint).then((info) => {
      if (!cancelled) setBoundSite(info);
    });
    return () => {
      cancelled = true;
    };
  }, [flightId, endpoint]);

  function reuse(siteId: string) {
    setError(null);
    startTransition(async () => {
      const result = await nameSite({ flightId, endpoint, mode: "reuse", existingSiteId: siteId });
      if (result.ok) onNamed(result);
      else setError(result.error);
    });
  }

  function create() {
    setError(null);
    if (name.trim().length === 0) {
      setError("Enter a name for this site.");
      return;
    }
    startTransition(async () => {
      const result = await nameSite({ flightId, endpoint, mode: "create", name, visibility });
      if (result.ok) onNamed(result);
      else setError(result.error);
    });
  }

  function unpublish() {
    setError(null);
    startTransition(async () => {
      const result = await unpublishSiteForFlight(flightId, endpoint);
      if (result.ok) setBoundSite((prev) => (prev ? { ...prev, visibility: "private" } : prev));
      else setError(result.error);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSiteForFlight(flightId, endpoint);
      if (result.ok) onUndone();
      else setError(result.error);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">
            Name this {ENDPOINT_LABEL[endpoint]}
          </h2>
          {currentName && (
            <p className="text-sm text-gray-500">Currently named &ldquo;{currentName}&rdquo;.</p>
          )}
        </div>

        {boundSite?.ownedByViewer && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
            <span className="text-xs text-gray-500">This is your site.</span>
            {boundSite.visibility === "public" && (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={unpublish}>
                Unpublish
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={remove}>
              Delete
            </Button>
          </div>
        )}

        {suggestions === null ? (
          <p className="text-sm text-gray-500">Checking for nearby sites…</p>
        ) : suggestions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
              Nearby sites
            </p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-condensed font-bold text-ink">{s.name}</span>
                    <span className="text-xs text-gray-500">
                      {formatDistance(s.distanceM)} {formatBearing(s.bearingDeg)} · {s.kind} ·{" "}
                      {s.visibility === "public" ? "public" : "private"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => reuse(s.id)}
                  >
                    Use this site
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-gray-200 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            {suggestions && suggestions.length > 0 ? "Or name a new site" : "Name this site"}
          </p>
          <input
            type="text"
            value={name}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder="e.g. Sonoma Ridge"
            maxLength={60}
            disabled={pending}
            className="h-10 rounded-md border border-gray-300 bg-paper px-3 text-sm text-ink outline-none focus:border-amber"
          />

          <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1">
            {(["public", "private"] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={pending}
                onClick={() => setVisibility(option)}
                aria-pressed={visibility === option}
                className={cn(
                  "h-8 rounded-sm px-2 font-condensed text-sm font-bold tracking-wide transition-colors disabled:opacity-60",
                  visibility === option
                    ? "bg-paper text-ink shadow-sm"
                    : "text-gray-600 hover:bg-paper/70",
                )}
              >
                {option === "public" ? "Public" : "Private"}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            {visibility === "public"
              ? "Public shares this name and location with every pilot — anyone flying nearby will see it too."
              : "Private keeps this name for you only. Other pilots will still see “Unknown site” on flights bound to it."}
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={create} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
