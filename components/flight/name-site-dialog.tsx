"use client";

import { useEffect, useState, useTransition } from "react";
import {
  nameSite,
  suggestLocationsForFlight,
  getBoundLocationInfo,
  unpublishSiteForFlight,
  deleteSiteForFlight,
  unpublishZoneForFlight,
  deleteZoneForFlight,
  type NameSiteResult,
  type BoundLocationInfo,
} from "@/app/flights/[id]/site-action";
import {
  listMyBoundaryEditableRows,
  saveBoundaryForOwnedRow,
  clearBoundaryForOwnedRow,
  getBoundaryForOwnedRow,
  type BoundaryEditableRows,
  type BoundaryEditorInitialState,
} from "@/app/flights/[id]/boundary-action";
import type { SiteEndpoint } from "@/lib/sites/associate";
import type { SiteChoice, ZoneChoice, SiteSuggestion, ZoneSuggestion } from "@/lib/sites/repo";
import type { SiteVisibility } from "@/lib/sites/visibility";
import type { BoundaryLevel } from "@/lib/sites/boundary";
import { radiusForKind, zoneRadiusForKind } from "@/lib/sites/geo";
import { formatDistance, formatBearing } from "@/lib/flights/format";
import { Button } from "@/components/ui/button";
import { BoundaryEditor } from "@/components/flight/boundary-editor";
import { LocationCommunityDialog } from "@/components/flight/location-community-dialog";
import { cn } from "@/lib/utils";

/**
 * Click-to-edit control for a flight's takeoff/landing site+zone label.
 * The flight's OWNER can bind a different site/zone to their own flight
 * (opens NameSiteDialog, unchanged). SPRINT-007: ANY viewer — including a
 * stranger looking at someone else's flight, including anonymous — can
 * open a lighter, PUBLIC community dialog (contributors, history,
 * endorsement, and — for a signed-in pilot — rename/redraw actions) for a
 * PUBLIC site/zone, since community-edit v1 means editing a public row is
 * no longer tied to flight ownership at all. `siteId`/`zoneId` come from
 * the viewer-scoped flight read (lib/flights/repo.ts's resolveLocationFields
 * already nulls them out exactly when the name is hidden), so a non-null
 * id here is always safe to hand to the client — it's never a private row.
 */
export function SiteNameControl({
  flightId,
  endpoint,
  initialSiteName,
  initialZoneName,
  siteId,
  zoneId,
  isOwner,
  className,
  as: As = "span",
}: {
  flightId: string;
  endpoint: SiteEndpoint;
  initialSiteName: string | null;
  initialZoneName: string | null;
  siteId: string | null;
  zoneId: string | null;
  isOwner: boolean;
  className?: string;
  as?: "h1" | "span";
}) {
  const [siteName, setSiteName] = useState(initialSiteName);
  const [zoneName, setZoneName] = useState(initialZoneName);
  const [open, setOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  // The zone is a detail of the site, not a co-equal heading — rendered at a
  // fraction of the site's own font size (em-based, so it scales whether
  // this is the big flight-header h1 or the small landing-line span) and
  // de-emphasized in weight/color rather than matching the site's.
  const content = siteName ? (
    <>
      {siteName}
      {zoneName && (
        <span className="text-[0.55em] font-normal text-gray-500">{` — ${zoneName}`}</span>
      )}
    </>
  ) : (
    "Unknown site"
  );

  if (!isOwner) {
    if (!siteId) return <As className={className}>{content}</As>;
    return (
      <>
        <As>
          <button
            type="button"
            onClick={() => setCommunityOpen(true)}
            className={cn(
              className,
              "cursor-pointer rounded-sm text-left underline decoration-dotted decoration-2 underline-offset-4 hover:decoration-solid",
            )}
            title="View this public location"
          >
            {content}
          </button>
        </As>
        {communityOpen && (
          <LocationCommunityDialog
            level={zoneId ? "zone" : "site"}
            id={zoneId ?? siteId}
            name={zoneId ? (zoneName ?? "this spot") : (siteName ?? "this site")}
            endpoint={endpoint}
            onClose={() => setCommunityOpen(false)}
          />
        )}
      </>
    );
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
          title={siteName ? "Edit this site" : "Name this site"}
        >
          {content}
        </button>
      </As>
      {open && (
        <NameSiteDialog
          flightId={flightId}
          endpoint={endpoint}
          currentSiteName={siteName}
          currentZoneName={zoneName}
          onClose={() => setOpen(false)}
          onNamed={(result) => {
            setSiteName(result.siteName);
            setZoneName(result.zoneName);
            setOpen(false);
          }}
          onSiteUndone={() => {
            setSiteName(null);
            setZoneName(null); // a zone can't outlive its site binding
            setOpen(false);
          }}
          onZoneUndone={() => {
            setZoneName(null); // the site binding survives — falls back to it
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

type Step = "site" | "zone" | "boundary-picker" | "boundary-editor";

/** The row a boundary is currently being drawn/edited for — set either from
 *  the picker (decision 5: reachable with no flight bound to the row) or as
 *  a shortcut from the site/zone step when that row is already bound and
 *  owned by the viewer. The anchor/current boundary are resolved by
 *  BoundaryStep itself via getBoundaryForOwnedRow — this only carries what's
 *  needed to ask for them and to show a reasonable reference circle. */
interface BoundaryTarget {
  level: BoundaryLevel;
  id: string;
  name: string;
  referenceRadiusM: number;
}

function NameSiteDialog({
  flightId,
  endpoint,
  currentSiteName,
  currentZoneName,
  onClose,
  onNamed,
  onSiteUndone,
  onZoneUndone,
}: {
  flightId: string;
  endpoint: SiteEndpoint;
  currentSiteName: string | null;
  currentZoneName: string | null;
  onClose: () => void;
  onNamed: (result: Extract<NameSiteResult, { ok: true }>) => void;
  onSiteUndone: () => void;
  onZoneUndone: () => void;
}) {
  const [suggestions, setSuggestions] = useState<SiteSuggestion[] | null>(null);
  const [boundInfo, setBoundInfo] = useState<BoundLocationInfo | null>(null);
  const [step, setStep] = useState<Step>(currentSiteName ? "zone" : "site");
  const [siteChoice, setSiteChoice] = useState<SiteChoice | null>(null);
  const [siteChoiceLabel, setSiteChoiceLabel] = useState<string | null>(currentSiteName);
  const [siteChoiceVisibility, setSiteChoiceVisibility] = useState<SiteVisibility>("public");

  const [siteNameInput, setSiteNameInput] = useState("");
  const [siteVisibility, setSiteVisibility] = useState<SiteVisibility>("public");
  const [zoneNameInput, setZoneNameInput] = useState("");
  const [zoneVisibility, setZoneVisibility] = useState<SiteVisibility>("public");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [pickerRows, setPickerRows] = useState<BoundaryEditableRows | null>(null);
  const [boundaryTarget, setBoundaryTarget] = useState<BoundaryTarget | null>(null);
  const [returnStep, setReturnStep] = useState<Step>("site");

  useEffect(() => {
    let cancelled = false;
    suggestLocationsForFlight(flightId, endpoint).then((rows) => {
      if (!cancelled) setSuggestions(rows);
    });
    getBoundLocationInfo(flightId, endpoint).then((info) => {
      if (cancelled) return;
      setBoundInfo(info);
      // Already-bound site: pre-fill the choice so the zone step can bind
      // to it without re-resolving the site.
      if (info.site) {
        setSiteChoice({ mode: "reuse", id: info.site.id });
        setSiteChoiceVisibility(info.site.visibility);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flightId, endpoint]);

  function chooseSiteReuse(id: string, name: string, visibility: SiteVisibility) {
    setError(null);
    setSiteChoice({ mode: "reuse", id });
    setSiteChoiceLabel(name);
    setSiteChoiceVisibility(visibility);
    setStep("zone");
  }

  function chooseSiteCreate() {
    setError(null);
    if (siteNameInput.trim().length === 0) {
      setError("Enter a name for this site.");
      return;
    }
    setSiteChoice({ mode: "create", name: siteNameInput, visibility: siteVisibility });
    setSiteChoiceLabel(siteNameInput);
    setSiteChoiceVisibility(siteVisibility);
    setStep("zone");
  }

  function submit(zone?: ZoneChoice) {
    if (!siteChoice) return;
    setError(null);
    startTransition(async () => {
      const result = await nameSite({ flightId, endpoint, site: siteChoice, zone });
      if (result.ok) onNamed(result);
      else setError(result.error);
    });
  }

  function reuseZone(id: string) {
    submit({ mode: "reuse", id });
  }

  function createZone() {
    if (zoneNameInput.trim().length === 0) {
      // Nothing typed. If this flight's endpoint is already bound to a zone
      // under the exact site being saved, "Save" with a blank name just
      // confirms that existing spot (shown as "Current" above, needing no
      // click of its own) rather than demanding a name for a spot that
      // already has one.
      if (boundInfo?.zone && siteChoice?.mode === "reuse" && siteChoice.id === boundInfo.site?.id) {
        reuseZone(boundInfo.zone.id);
        return;
      }
      setError("Enter a name for this spot.");
      return;
    }
    submit({ mode: "create", name: zoneNameInput, visibility: zoneVisibility });
  }

  function skipZone() {
    submit(undefined);
  }

  function unpublishSite() {
    setError(null);
    startTransition(async () => {
      const result = await unpublishSiteForFlight(flightId, endpoint);
      if (result.ok) setBoundInfo((prev) => (prev?.site ? { ...prev, site: { ...prev.site, visibility: "private" } } : prev));
      else setError(result.error);
    });
  }

  function removeSite() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSiteForFlight(flightId, endpoint);
      if (result.ok) onSiteUndone();
      else setError(result.error);
    });
  }

  function unpublishZone() {
    setError(null);
    startTransition(async () => {
      const result = await unpublishZoneForFlight(flightId, endpoint);
      if (result.ok) setBoundInfo((prev) => (prev?.zone ? { ...prev, zone: { ...prev.zone, visibility: "private" } } : prev));
      else setError(result.error);
    });
  }

  function removeZone() {
    setError(null);
    startTransition(async () => {
      const result = await deleteZoneForFlight(flightId, endpoint);
      if (result.ok) onZoneUndone();
      else setError(result.error);
    });
  }

  /**
   * The owner-scoped picker (decision 5) — reachable regardless of whether
   * this flight's endpoint is bound to anything, since it lists the
   * caller's OWN sites/zones rather than deriving from this flight at all.
   */
  function openBoundaryPicker() {
    setError(null);
    setReturnStep(step);
    setStep("boundary-picker");
    if (!pickerRows) {
      listMyBoundaryEditableRows().then(setPickerRows);
    }
  }

  function openBoundaryEditorFor(target: BoundaryTarget) {
    setError(null);
    setBoundaryTarget(target);
    setStep("boundary-editor");
  }

  function openBoundaryForCurrentSite() {
    if (!boundInfo?.site) return;
    setReturnStep(step);
    openBoundaryEditorFor({
      level: "site",
      id: boundInfo.site.id,
      name: siteChoiceLabel ?? currentSiteName ?? "this site",
      referenceRadiusM: radiusForKind(endpoint),
    });
  }

  function openBoundaryForCurrentZone() {
    if (!boundInfo?.zone) return;
    setReturnStep(step);
    openBoundaryEditorFor({
      level: "zone",
      id: boundInfo.zone.id,
      name: currentZoneName ?? "this spot",
      referenceRadiusM: zoneRadiusForKind(endpoint),
    });
  }

  const zoneStepDisabled = siteChoiceVisibility !== "public";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "site" && (
          <SiteStep
            endpointLabel={ENDPOINT_LABEL[endpoint]}
            currentSiteName={currentSiteName}
            suggestions={suggestions}
            boundInfo={boundInfo}
            pending={pending}
            error={error}
            siteNameInput={siteNameInput}
            setSiteNameInput={setSiteNameInput}
            siteVisibility={siteVisibility}
            setSiteVisibility={setSiteVisibility}
            onReuse={chooseSiteReuse}
            onCreate={chooseSiteCreate}
            onUnpublish={unpublishSite}
            onDelete={removeSite}
            onEditBoundary={boundInfo?.site?.ownedByViewer ? openBoundaryForCurrentSite : undefined}
            onOpenPicker={openBoundaryPicker}
            onClose={onClose}
          />
        )}
        {step === "zone" && (
          <ZoneStep
            endpointLabel={ENDPOINT_LABEL[endpoint]}
            siteLabel={siteChoiceLabel}
            currentZoneName={currentZoneName}
            zoneSuggestions={
              siteChoice?.mode === "reuse"
                ? (suggestions?.find((s) => s.id === siteChoice.id)?.zones ?? [])
                : []
            }
            boundInfo={boundInfo}
            pending={pending}
            error={error}
            zoneNameInput={zoneNameInput}
            setZoneNameInput={setZoneNameInput}
            zoneVisibility={zoneVisibility}
            setZoneVisibility={setZoneVisibility}
            disabledPublic={zoneStepDisabled}
            showBackToSite={!currentSiteName}
            onBack={() => setStep("site")}
            onReuse={reuseZone}
            onCreate={createZone}
            onSkip={skipZone}
            onUnpublish={unpublishZone}
            onDelete={removeZone}
            onEditSiteBoundary={boundInfo?.site?.ownedByViewer ? openBoundaryForCurrentSite : undefined}
            onEditZoneBoundary={boundInfo?.zone?.ownedByViewer ? openBoundaryForCurrentZone : undefined}
            onOpenPicker={openBoundaryPicker}
            onClose={onClose}
          />
        )}
        {step === "boundary-picker" && (
          <BoundaryPickerStep
            rows={pickerRows}
            onChoose={(target) => openBoundaryEditorFor(target)}
            onBack={() => setStep(returnStep)}
            onClose={onClose}
          />
        )}
        {step === "boundary-editor" && boundaryTarget && (
          <BoundaryStep
            target={boundaryTarget}
            onBack={() => {
              setBoundaryTarget(null);
              setStep(returnStep);
            }}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function SiteStep({
  endpointLabel,
  currentSiteName,
  suggestions,
  boundInfo,
  pending,
  error,
  siteNameInput,
  setSiteNameInput,
  siteVisibility,
  setSiteVisibility,
  onReuse,
  onCreate,
  onUnpublish,
  onDelete,
  onEditBoundary,
  onOpenPicker,
  onClose,
}: {
  endpointLabel: string;
  currentSiteName: string | null;
  suggestions: SiteSuggestion[] | null;
  boundInfo: BoundLocationInfo | null;
  pending: boolean;
  error: string | null;
  siteNameInput: string;
  setSiteNameInput: (v: string) => void;
  siteVisibility: SiteVisibility;
  setSiteVisibility: (v: SiteVisibility) => void;
  onReuse: (id: string, name: string, visibility: SiteVisibility) => void;
  onCreate: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  onEditBoundary?: () => void;
  onOpenPicker: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">
          Name this {endpointLabel}
        </h2>
        {currentSiteName && (
          <p className="text-sm text-gray-500">Currently named &ldquo;{currentSiteName}&rdquo;.</p>
        )}
      </div>

      {boundInfo?.site?.ownedByViewer && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
          <span className="text-xs text-gray-500">This is your site.</span>
          {boundInfo.site.visibility === "public" && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onUnpublish}>
              Unpublish
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onDelete}>
            Delete
          </Button>
          {onEditBoundary && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onEditBoundary}>
              Edit boundary
            </Button>
          )}
        </div>
      )}

      {suggestions === null ? (
        <p className="text-sm text-gray-500">Checking for nearby sites…</p>
      ) : suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Nearby sites</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-col gap-1.5 rounded-md border border-gray-200 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
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
                    onClick={() => onReuse(s.id, s.name, s.visibility)}
                  >
                    Use this site
                  </Button>
                </div>
                {s.zones.length > 0 && (
                  <ul className="ml-3 flex flex-col gap-1 border-l border-gray-200 pl-3">
                    {s.zones.map((z) => (
                      <li key={z.id} className="flex items-center justify-between gap-2 text-xs text-gray-500">
                        <span>
                          {z.name} — {formatDistance(z.distanceM)} {formatBearing(z.bearingDeg)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
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
          value={siteNameInput}
          onChange={(e) => setSiteNameInput(e.target.value)}
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
              onClick={() => setSiteVisibility(option)}
              aria-pressed={siteVisibility === option}
              className={cn(
                "h-8 rounded-sm px-2 font-condensed text-sm font-bold tracking-wide transition-colors disabled:opacity-60",
                siteVisibility === option ? "bg-paper text-ink shadow-sm" : "text-gray-600 hover:bg-paper/70",
              )}
            >
              {option === "public" ? "Public" : "Private"}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {siteVisibility === "public"
            ? "Public shares this name and location with every pilot — anyone flying nearby will see it too."
            : "Private keeps this name for you only. Other pilots will still see “Unknown site” on flights bound to it."}
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={pending}
            className="text-xs text-gray-500 underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-60"
          >
            Edit a boundary on one of my sites
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onCreate} disabled={pending}>
              {pending ? "Saving…" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function ZoneStep({
  endpointLabel,
  siteLabel,
  currentZoneName,
  zoneSuggestions,
  boundInfo,
  pending,
  error,
  zoneNameInput,
  setZoneNameInput,
  zoneVisibility,
  setZoneVisibility,
  disabledPublic,
  showBackToSite,
  onBack,
  onReuse,
  onCreate,
  onSkip,
  onUnpublish,
  onDelete,
  onEditSiteBoundary,
  onEditZoneBoundary,
  onOpenPicker,
  onClose,
}: {
  endpointLabel: string;
  siteLabel: string | null;
  currentZoneName: string | null;
  zoneSuggestions: ZoneSuggestion[];
  boundInfo: BoundLocationInfo | null;
  pending: boolean;
  error: string | null;
  zoneNameInput: string;
  setZoneNameInput: (v: string) => void;
  zoneVisibility: SiteVisibility;
  setZoneVisibility: (v: SiteVisibility) => void;
  disabledPublic: boolean;
  showBackToSite: boolean;
  onBack: () => void;
  onReuse: (id: string) => void;
  onCreate: () => void;
  onSkip: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  onEditSiteBoundary?: () => void;
  onEditZoneBoundary?: () => void;
  onOpenPicker: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">
          Which {endpointLabel} spot?
        </h2>
        <p className="text-sm text-gray-500">
          {siteLabel ? <>Part of &ldquo;{siteLabel}&rdquo;.</> : null}{" "}
          {currentZoneName ? (
            <>Currently named &ldquo;{currentZoneName}&rdquo;.</>
          ) : (
            "Optional — a specific launch or landing spot within this site."
          )}
        </p>
      </div>

      {(boundInfo?.zone?.ownedByViewer || boundInfo?.site?.ownedByViewer) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
          <span className="text-xs text-gray-500">
            {boundInfo?.zone?.ownedByViewer ? "This is your spot." : "You own the parent site."}
          </span>
          {boundInfo?.zone?.ownedByViewer && boundInfo.zone.visibility === "public" && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onUnpublish}>
              Unpublish
            </Button>
          )}
          {boundInfo?.zone?.ownedByViewer && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onDelete}>
              Delete
            </Button>
          )}
          {onEditZoneBoundary && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onEditZoneBoundary}>
              Edit spot boundary
            </Button>
          )}
          {onEditSiteBoundary && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onEditSiteBoundary}>
              Edit site boundary
            </Button>
          )}
        </div>
      )}

      {zoneSuggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Nearby spots</p>
          <ul className="flex flex-col gap-2">
            {zoneSuggestions.map((z) => {
              // Already bound to this flight — it's the current choice, not
              // just a nearby candidate, so show it as selected instead of
              // making the user re-click "Use this spot" on the very spot
              // that's already in effect.
              const isCurrent = boundInfo?.zone?.id === z.id;
              return (
                <li
                  key={z.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                    isCurrent ? "border-amber bg-amber/10" : "border-gray-200",
                  )}
                >
                  <div className="flex flex-col">
                    <span className="font-condensed font-bold text-ink">{z.name}</span>
                    <span className="text-xs text-gray-500">
                      {formatDistance(z.distanceM)} {formatBearing(z.bearingDeg)} · {z.kind} ·{" "}
                      {z.visibility === "public" ? "public" : "private"}
                    </span>
                  </div>
                  {isCurrent ? (
                    <span className="font-condensed text-sm font-bold tracking-wide text-amber">Current</span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onReuse(z.id)}
                    >
                      Use this spot
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-gray-200 pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          {zoneSuggestions.length > 0 ? "Or add a new spot" : "Add a spot"}
        </p>
        <input
          type="text"
          value={zoneNameInput}
          onChange={(e) => setZoneNameInput(e.target.value)}
          placeholder="e.g. North Launch"
          maxLength={60}
          disabled={pending}
          className="h-10 rounded-md border border-gray-300 bg-paper px-3 text-sm text-ink outline-none focus:border-amber"
        />

        <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1">
          {(["public", "private"] as const).map((option) => {
            const disabled = pending || (option === "public" && disabledPublic);
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => setZoneVisibility(option)}
                aria-pressed={zoneVisibility === option}
                title={option === "public" && disabledPublic ? "Publish the site first, or keep this spot private." : undefined}
                className={cn(
                  "h-8 rounded-sm px-2 font-condensed text-sm font-bold tracking-wide transition-colors disabled:opacity-60",
                  zoneVisibility === option ? "bg-paper text-ink shadow-sm" : "text-gray-600 hover:bg-paper/70",
                )}
              >
                {option === "public" ? "Public" : "Private"}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          {disabledPublic
            ? "This site is private, so this spot can only be private too — publish the site first if you want to share it."
            : zoneVisibility === "public"
              ? "Public shares this spot's name and location with every pilot — anyone flying nearby will see it too."
              : "Private keeps this spot for you only. Other pilots will still see just the site name."}
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={pending}
            className="text-xs text-gray-500 underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-60"
          >
            Edit a boundary on one of my sites
          </button>
          <div className="flex flex-wrap justify-end gap-2">
            {showBackToSite && (
              <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>
                Back
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onSkip} disabled={pending}>
              Skip — just the site
            </Button>
            <Button type="button" size="sm" onClick={onCreate} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The owner-scoped picker (decision 5): lists every site/zone the caller
 * owns or edit-controls, reachable with NO flight bound to the target row
 * — the fix for the reachability gap both independent SPRINT-006 drafts
 * left. Selecting a row opens BoundaryStep for it.
 */
function BoundaryPickerStep({
  rows,
  onChoose,
  onBack,
  onClose,
}: {
  rows: BoundaryEditableRows | null;
  onChoose: (target: BoundaryTarget) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">Edit a boundary</h2>
        <p className="text-sm text-gray-500">Pick one of your sites or spots to draw or change its boundary.</p>
      </div>

      {rows === null ? (
        <p className="text-sm text-gray-500">Loading your sites…</p>
      ) : rows.sites.length === 0 && rows.zones.length === 0 ? (
        <p className="text-sm text-gray-500">You don&rsquo;t own any named sites or spots yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.sites.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">My sites</p>
              <ul className="flex flex-col gap-2">
                {rows.sites.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-condensed font-bold text-ink">{s.name}</span>
                      <span className="text-xs text-gray-500">
                        {s.visibility === "public" ? "public" : "private"} · {s.hasBoundary ? "has a boundary" : "circle matching"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChoose({ level: "site", id: s.id, name: s.name, referenceRadiusM: radiusForKind("takeoff") })
                      }
                    >
                      {s.hasBoundary ? "Edit" : "Draw"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rows.zones.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">My spots</p>
              <ul className="flex flex-col gap-2">
                {rows.zones.map((z) => (
                  <li key={z.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-condensed font-bold text-ink">
                        {z.siteName} — {z.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {z.visibility === "public" ? "public" : "private"} · {z.hasBoundary ? "has a boundary" : "circle matching"}
                        {z.editableAsSiteOwner ? " · via your site" : ""}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChoose({ level: "zone", id: z.id, name: z.name, referenceRadiusM: zoneRadiusForKind("takeoff") })
                      }
                    >
                      {z.hasBoundary ? "Edit" : "Draw"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

/**
 * Resolves the anchor + current boundary for `target` (owner-gated —
 * returns nothing for a row the caller can't edit) and hosts the
 * MapLibre editor. Save/clear go through the picker's own owned-row
 * actions, which re-verify ownership regardless of how `target.id` arrived
 * here (the picker, or a bound-flight shortcut).
 */
function BoundaryStep({
  target,
  onBack,
  onClose,
}: {
  target: BoundaryTarget;
  onBack: () => void;
  onClose: () => void;
}) {
  const [initial, setInitial] = useState<BoundaryEditorInitialState | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getBoundaryForOwnedRow(target.level, target.id).then((result) => {
      if (!cancelled) setInitial(result);
    });
    return () => {
      cancelled = true;
    };
  }, [target.level, target.id]);

  if (initial === undefined) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (initial === null) {
    return (
      <>
        <p className="text-sm text-red-600">You don&rsquo;t have permission to edit this boundary.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">
            Boundary for &ldquo;{target.name}&rdquo;
          </h2>
          <p className="text-sm text-gray-500">
            Draw the actual shape instead of the default circle. The dashed ring is what you&rsquo;re replacing.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <BoundaryEditor
        anchor={initial.anchor}
        initialBoundary={initial.boundary}
        level={target.level}
        referenceRadiusM={target.referenceRadiusM}
        nearby={initial.nearby}
        onSave={(raw) => saveBoundaryForOwnedRow(target.level, target.id, raw)}
        onClear={() => clearBoundaryForOwnedRow(target.level, target.id)}
        onCancel={onBack}
        onSaved={onBack}
      />
    </>
  );
}
