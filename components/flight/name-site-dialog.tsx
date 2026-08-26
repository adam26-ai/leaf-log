"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  nameSite,
  suggestLocationsForFlight,
  getBoundLocationInfo,
  deleteSiteForFlight,
  unpublishZoneForFlight,
  deleteZoneForFlight,
  type NameSiteResult,
  type BoundLocationInfo,
  type BoundSiteInfo,
} from "@/app/flights/[id]/site-action";
import {
  listMyBoundaryEditableRows,
  saveBoundaryForOwnedRow,
  clearBoundaryForOwnedRow,
  getBoundaryForOwnedRow,
  type BoundaryEditableRows,
  type BoundaryEditorInitialState,
} from "@/app/flights/[id]/boundary-action";
import { renamePublicRow } from "@/app/flights/[id]/community-action";
import type { SiteEndpoint } from "@/lib/sites/associate";
import type { SiteChoice, ZoneChoice, SiteSuggestion, ZoneSuggestion } from "@/lib/sites/repo";
import type { SiteVisibility } from "@/lib/sites/visibility";
import type { BoundaryLevel } from "@/lib/sites/boundary";
import { radiusForKind, zoneRadiusForKind } from "@/lib/sites/geo";
import { formatDistance, formatBearing } from "@/lib/flights/format";
import { Button } from "@/components/ui/button";
import { BoundaryEditor, type BoundaryEditorHandle } from "@/components/flight/boundary-editor";
import { LocationCommunityDialog } from "@/components/flight/location-community-dialog";
import { SiteAreaMap } from "@/components/flight/site-area-map";
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
  zonesEnabled,
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
  /** SPRINT-008: server-derived (a client component can't read
   *  process.env), threaded down from FlightHeader — see
   *  lib/sites/zones-enabled.ts. Gates the naming dialog's zone step and
   *  zone-level community access; the data itself is already stripped by
   *  lib/flights/repo.ts's resolveEndpoint when disabled, this closes the
   *  path structurally too. */
  zonesEnabled: boolean;
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
            level={zoneId && zonesEnabled ? "zone" : "site"}
            id={zoneId && zonesEnabled ? zoneId : siteId}
            name={zoneId && zonesEnabled ? (zoneName ?? "this spot") : (siteName ?? "this site")}
            endpoint={endpoint}
            onClose={() => setCommunityOpen(false)}
            onRenamed={(newName) => (zoneId && zonesEnabled ? setZoneName(newName) : setSiteName(newName))}
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
          zonesEnabled={zonesEnabled}
          onClose={() => setOpen(false)}
          onNamed={(result) => {
            setSiteName(result.siteName);
            setZoneName(result.zoneName);
            setOpen(false);
          }}
          onCommunityRenamed={(newName, level) => (level === "site" ? setSiteName(newName) : setZoneName(newName))}
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

type Step = "site-overview" | "site-edit" | "site" | "zone" | "boundary-picker" | "boundary-editor" | "community";

/** The row the new community dialog (contributors/history/endorse — plus
 *  rename/redraw for a signed-in pilot) is currently open for, reached as a
 *  step within the OWNER's own flow — mirroring BoundaryTarget's shape.
 *  Non-owners reach LocationCommunityDialog directly from SiteNameControl
 *  instead; an owner reaches it from here so it's available even though
 *  clicking the label itself opens this bind-a-site flow for them. */
interface CommunityTarget {
  level: BoundaryLevel;
  id: string;
  name: string;
}

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
  zonesEnabled,
  onClose,
  onNamed,
  onSiteUndone,
  onZoneUndone,
  onCommunityRenamed,
}: {
  flightId: string;
  endpoint: SiteEndpoint;
  currentSiteName: string | null;
  currentZoneName: string | null;
  /** SPRINT-008: see SiteNameControl's own prop doc. */
  zonesEnabled: boolean;
  onClose: () => void;
  onNamed: (result: Extract<NameSiteResult, { ok: true }>) => void;
  onSiteUndone: () => void;
  onZoneUndone: () => void;
  /** A rename made from the community dialog reached via this flow (see
   *  CommunityTarget) — lets SiteNameControl's own h1 follow it live, the
   *  same live-update path the non-owner LocationCommunityDialog usage has. */
  onCommunityRenamed: (newName: string, level: BoundaryLevel) => void;
}) {
  const [suggestions, setSuggestions] = useState<SiteSuggestion[] | null>(null);
  const [boundInfo, setBoundInfo] = useState<BoundLocationInfo | null>(null);
  // A bound-flight opens on a read-only overview first (SPRINT-008: bug
  // report — typing a new name while a site was pre-selected could still
  // silently create a site from stale text). An unknown site has nothing
  // to show an overview of, so it goes straight to the create/choose flow.
  const [step, setStep] = useState<Step>(
    zonesEnabled && currentSiteName ? "zone" : currentSiteName ? "site-overview" : "site",
  );
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
  const [communityTarget, setCommunityTarget] = useState<CommunityTarget | null>(null);
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
    // Clear any leftover text in the "new site" field — otherwise it would
    // silently win over this explicit reuse pick the moment Save is
    // clicked, since chooseSiteCreate branches on the input being non-empty.
    setSiteNameInput("");
    // "Use this site" only SELECTS it — it never submits on its own. The
    // pilot still has to click "Save" to persist it, the same as picking a
    // zone always required before this sprint (reuseZone never auto-saved
    // either). Zones-enabled keeps its own separate step to advance to.
    if (zonesEnabled) setStep("zone");
  }

  function chooseSiteCreate() {
    setError(null);
    if (siteNameInput.trim().length === 0) {
      // Nothing typed. If a site is already selected (the flight's current
      // binding, pre-filled on open, or a prior "Use this site" pick),
      // "Save" just confirms it rather than demanding a name for a site
      // that already has one — mirrors the same pattern the (now-hidden)
      // zone step's blank-name Save already used for its own current zone.
      if (siteChoice) {
        submit(siteChoice, undefined);
        return;
      }
      setError("Enter a name for this site.");
      return;
    }
    setSiteChoice({ mode: "create", name: siteNameInput, visibility: siteVisibility });
    setSiteChoiceLabel(siteNameInput);
    setSiteChoiceVisibility(siteVisibility);
    if (zonesEnabled) setStep("zone");
    else submit({ mode: "create", name: siteNameInput, visibility: siteVisibility }, undefined);
  }

  // SPRINT-008: typing a new name is a clear signal the pilot means to
  // create a different site, not confirm whichever one was pre-selected
  // (the flight's current binding, or an earlier "Use this site" pick) —
  // deselect it so "Save" goes back to requiring/using the typed name.
  function handleSiteNameInputChange(value: string) {
    setSiteNameInput(value);
    if (value.trim().length > 0 && siteChoice) {
      setSiteChoice(null);
      setSiteChoiceLabel(null);
    }
  }

  function openSiteEdit() {
    setError(null);
    setStep("site-edit");
  }

  // Starting fresh — clears whatever was pre-selected (the flight's
  // current binding) so the choose/create step doesn't show it as
  // "Current" or let a blank Save silently re-confirm it.
  function chooseCreateDifferentSite() {
    setError(null);
    setSiteChoice(null);
    setSiteChoiceLabel(null);
    setSiteNameInput("");
    setStep("site");
  }

  // SPRINT-008: takes `site` explicitly rather than reading the `siteChoice`
  // state — chooseSiteReuse/chooseSiteCreate call this in the same tick
  // they set that state (to submit immediately when zones are disabled),
  // and a state update isn't visible to a same-tick closure.
  function submit(site: SiteChoice, zone?: ZoneChoice) {
    setError(null);
    startTransition(async () => {
      const result = await nameSite({ flightId, endpoint, site, zone });
      if (result.ok) onNamed(result);
      else setError(result.error);
    });
  }

  function reuseZone(id: string) {
    if (!siteChoice) return;
    submit(siteChoice, { mode: "reuse", id });
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
    if (!siteChoice) return;
    submit(siteChoice, { mode: "create", name: zoneNameInput, visibility: zoneVisibility });
  }

  function skipZone() {
    if (!siteChoice) return;
    submit(siteChoice, undefined);
  }

  // Renames the bound site itself (not the "name a new site" flow) —
  // renamePublicRow already allows this for the site's own owner
  // regardless of visibility (canCommunityEditSite: owner always passes).
  // On success, propagates live the same way a community-dialog rename
  // does (onCommunityRenamed updates SiteNameControl's own displayed h1).
  function saveSiteName(newName: string) {
    setError(null);
    const trimmed = newName.trim();
    if (trimmed.length === 0) {
      setError("Enter a name for this site.");
      return;
    }
    const siteId = boundInfo?.site?.id;
    if (!siteId) return;
    startTransition(async () => {
      const result = await renamePublicRow("site", siteId, trimmed);
      if (result.ok) {
        setSiteChoiceLabel(trimmed);
        setBoundInfo((prev) => (prev?.site ? { ...prev, site: { ...prev.site, name: trimmed } } : prev));
        onCommunityRenamed(trimmed, "site");
        setStep("site-overview");
      } else {
        setError(result.error);
      }
    });
  }

  // SiteEditStep calls this right after successfully committing a boundary
  // edit — boundInfo.site.boundary is otherwise only ever fetched once, on
  // mount, so without this the site-overview map a successful Save
  // returns to would keep showing whatever boundary (or lack of one)
  // existed when the dialog first opened.
  async function refreshBoundInfo() {
    const info = await getBoundLocationInfo(flightId, endpoint);
    setBoundInfo(info);
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

  /** SPRINT-007: the owner's own path to the community dialog (contributors/
   *  history/endorse) for their PUBLIC site — clicking the h1 itself always
   *  opens this bind-a-site flow for the owner, so without this the owner
   *  would have no way to reach the same dialog a stranger can. */
  function openCommunityForCurrentSite() {
    if (!boundInfo?.site) return;
    setReturnStep(step);
    setCommunityTarget({ level: "site", id: boundInfo.site.id, name: siteChoiceLabel ?? currentSiteName ?? "this site" });
    setStep("community");
  }

  function openCommunityForCurrentZone() {
    if (!boundInfo?.zone) return;
    setReturnStep(step);
    setCommunityTarget({ level: "zone", id: boundInfo.zone.id, name: currentZoneName ?? "this spot" });
    setStep("community");
  }

  const zoneStepDisabled = siteChoiceVisibility !== "public";

  // LocationCommunityDialog supplies its OWN full overlay/box (it's also
  // used standalone, from SiteNameControl's non-owner path) — rendering it
  // inside this component's own overlay/box below would nest one modal
  // inside another. Swap it in as a full replacement instead.
  if (step === "community" && communityTarget) {
    return (
      <LocationCommunityDialog
        level={communityTarget.level}
        id={communityTarget.id}
        name={communityTarget.name}
        endpoint={endpoint}
        onClose={onClose}
        onRenamed={(newName) => {
          setCommunityTarget((t) => (t ? { ...t, name: newName } : t));
          onCommunityRenamed(newName, communityTarget.level);
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "site-overview" && (
          <SiteOverviewStep
            endpointLabel={ENDPOINT_LABEL[endpoint]}
            currentSiteName={currentSiteName}
            siteInfo={boundInfo?.site ?? null}
            flightPoint={boundInfo?.flightPoint ?? null}
            radiusM={radiusForKind(endpoint)}
            onEdit={openSiteEdit}
            onChooseDifferent={chooseCreateDifferentSite}
            onClose={onClose}
          />
        )}
        {step === "site-edit" && boundInfo?.site && (
          <SiteEditStep
            endpointLabel={ENDPOINT_LABEL[endpoint]}
            siteId={boundInfo.site.id}
            initialName={boundInfo.site.name}
            radiusM={radiusForKind(endpoint)}
            pending={pending}
            error={error}
            onSaveName={saveSiteName}
            onBoundarySaved={refreshBoundInfo}
            onDelete={removeSite}
            onBack={() => setStep("site-overview")}
          />
        )}
        {step === "site" && (
          <SiteStep
            endpointLabel={ENDPOINT_LABEL[endpoint]}
            currentSiteName={currentSiteName}
            suggestions={suggestions}
            selectedSiteId={siteChoice?.mode === "reuse" ? siteChoice.id : null}
            pending={pending}
            error={error}
            siteNameInput={siteNameInput}
            setSiteNameInput={handleSiteNameInputChange}
            siteVisibility={siteVisibility}
            setSiteVisibility={setSiteVisibility}
            onReuse={chooseSiteReuse}
            onCreate={chooseSiteCreate}
            onOpenPicker={openBoundaryPicker}
            onClose={onClose}
          />
        )}
        {step === "zone" && zonesEnabled && (
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
            onViewSiteCommunity={boundInfo?.site?.visibility === "public" ? openCommunityForCurrentSite : undefined}
            onViewZoneCommunity={boundInfo?.zone?.visibility === "public" ? openCommunityForCurrentZone : undefined}
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

/**
 * The dialog's landing view for a flight that already has a site bound
 * (SPRINT-008): read-only summary plus a map of the site's own area
 * (drawn boundary, or the reference circle) with this flight's own fix
 * marked on it — so a pilot can tell at a glance whether they're looking
 * at the right place before deciding to edit it or pick something else.
 * A flight with no site bound skips this step entirely (nothing to show
 * an overview of) and lands directly on SiteStep's choose/create flow.
 */
function SiteOverviewStep({
  endpointLabel,
  currentSiteName,
  siteInfo,
  flightPoint,
  radiusM,
  onEdit,
  onChooseDifferent,
  onClose,
}: {
  endpointLabel: string;
  currentSiteName: string | null;
  siteInfo: BoundSiteInfo | null;
  flightPoint: { lat: number; lon: number } | null;
  radiusM: number;
  onEdit: () => void;
  onChooseDifferent: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">
          {siteInfo?.name ?? currentSiteName}
        </h2>
        <p className="text-sm text-gray-500">
          {endpointLabel} site{siteInfo ? ` · ${siteInfo.visibility === "public" ? "Public" : "Private"}` : ""}
        </p>
      </div>

      {siteInfo ? (
        <SiteAreaMap
          anchor={{ lat: siteInfo.lat, lon: siteInfo.lon }}
          radiusM={radiusM}
          boundary={siteInfo.boundary}
          flightPoint={flightPoint}
        />
      ) : (
        <p className="text-sm text-gray-500">Loading site details…</p>
      )}

      <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-paper px-6 py-4">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onChooseDifferent}>
            Choose a different site
          </Button>
          {siteInfo?.ownedByViewer && (
            <Button type="button" size="sm" onClick={onEdit}>
              Edit this site
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The owned-site management view, reached from SiteOverviewStep's "Edit
 * this site": rename the site and draw/redraw its boundary in one screen
 * (both reachable with no extra click, per the user's own report that a
 * separate "Edit boundary" hop was one click too many), then Cancel/
 * Delete/Save at the bottom. Visibility is deliberately NOT editable here
 * (see the user's own call — SPRINT-008 chat) — a site's visibility stays
 * fixed after creation.
 */
function SiteEditStep({
  endpointLabel,
  siteId,
  initialName,
  radiusM,
  pending,
  error,
  onSaveName,
  onBoundarySaved,
  onDelete,
  onBack,
}: {
  endpointLabel: string;
  siteId: string;
  initialName: string;
  radiusM: number;
  pending: boolean;
  error: string | null;
  onSaveName: (newName: string) => void;
  /** Tells the dialog to refetch boundInfo — the site-overview map this
   *  screen returns to on a successful Save otherwise keeps showing
   *  whatever boundary existed when the dialog first opened. */
  onBoundarySaved: () => void | Promise<void>;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [nameInput, setNameInput] = useState(initialName);
  const [boundaryInitial, setBoundaryInitial] = useState<BoundaryEditorInitialState | null | undefined>(undefined);
  // Bumped only once the refetch below has actually landed, so the remount
  // it triggers (via BoundaryEditor's key) picks up the FRESH
  // initialBoundary — it only reads that prop at mount time (the live
  // draft lives in a ref, deliberately unreactive to prop changes so a
  // stray re-render can't blow away in-progress edits), so without this
  // the "currently saved boundary" dashed reference would stay stale after
  // a save in the same sitting, without needing to close and re-open.
  const [boundaryVersion, setBoundaryVersion] = useState(0);
  const boundaryRef = useRef<BoundaryEditorHandle>(null);
  const [combinedSaving, setCombinedSaving] = useState(false);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBoundaryForOwnedRow("site", siteId).then((result) => {
      if (!cancelled) setBoundaryInitial(result);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  function refreshBoundary() {
    getBoundaryForOwnedRow("site", siteId).then((result) => {
      setBoundaryInitial(result);
      setBoundaryVersion((v) => v + 1);
    });
  }

  // The single Save button covers both the name AND any pending boundary
  // edit — the boundary editor no longer has its own visible Save (see
  // showSaveButton={false} below). commitIfDirty() is a no-op (returns
  // null) unless the pilot actually touched the boundary, so renaming
  // alone never triggers a spurious boundary re-save/audit entry.
  async function handleSaveAll() {
    setBoundaryError(null);
    setCombinedSaving(true);
    const result = await boundaryRef.current?.commitIfDirty();
    setCombinedSaving(false);
    // "invalid" means the draft failed live client-side validation — the
    // boundary editor already shows that inline, so block silently rather
    // than repeat it in a second, duplicate error banner here.
    if (result === "invalid") return;
    if (result && !result.ok) {
      setBoundaryError(result.error);
      return;
    }
    if (result?.ok) await onBoundarySaved();
    onSaveName(nameInput);
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">Editing this site</h2>
        <p className="text-sm text-gray-500">This is your {endpointLabel} site.</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Name</p>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={60}
          disabled={pending}
          className="h-10 rounded-md border border-gray-300 bg-paper px-3 text-sm text-ink outline-none focus:border-amber"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-gray-200 pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Boundary</p>
        {boundaryInitial === undefined ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : boundaryInitial === null ? (
          <p className="text-sm text-red-600">You don&rsquo;t have permission to edit this boundary.</p>
        ) : (
          <BoundaryEditor
            // Remounts on every successful save/clear (see boundaryVersion's
            // own comment) — the fresh initialBoundary is only ever read at
            // mount time.
            key={boundaryVersion}
            ref={boundaryRef}
            anchor={boundaryInitial.anchor}
            initialBoundary={boundaryInitial.boundary}
            level="site"
            referenceRadiusM={radiusM}
            nearby={boundaryInitial.nearby}
            onSave={(raw) => saveBoundaryForOwnedRow("site", siteId, raw)}
            onClear={() => clearBoundaryForOwnedRow("site", siteId)}
            onCancel={onBack}
            onSaved={refreshBoundary}
            showCancel={false}
            showSaveButton={false}
          />
        )}
      </div>

      {(boundaryError ?? error) && <p className="text-sm text-red-600">{boundaryError ?? error}</p>}

      <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between gap-2 border-t border-gray-200 bg-paper px-6 py-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending || combinedSaving}>
          Cancel
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="danger" size="sm" onClick={onDelete} disabled={pending || combinedSaving}>
            Delete
          </Button>
          <Button type="button" size="sm" onClick={handleSaveAll} disabled={pending || combinedSaving}>
            {pending || combinedSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}

function SiteStep({
  endpointLabel,
  currentSiteName,
  suggestions,
  selectedSiteId,
  pending,
  error,
  siteNameInput,
  setSiteNameInput,
  siteVisibility,
  setSiteVisibility,
  onReuse,
  onCreate,
  onOpenPicker,
  onClose,
}: {
  endpointLabel: string;
  currentSiteName: string | null;
  suggestions: SiteSuggestion[] | null;
  /** The site `siteChoice` currently points at — null once the pilot starts
   *  typing a new name (deselecting whatever was pre-picked), or once
   *  "Choose a different site" from the overview step clears it outright.
   *  Drives the "Current" badge below. */
  selectedSiteId: string | null;
  pending: boolean;
  error: string | null;
  siteNameInput: string;
  setSiteNameInput: (v: string) => void;
  siteVisibility: SiteVisibility;
  setSiteVisibility: (v: SiteVisibility) => void;
  onReuse: (id: string, name: string, visibility: SiteVisibility) => void;
  onCreate: () => void;
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

      {suggestions === null ? (
        <p className="text-sm text-gray-500">Checking for nearby sites…</p>
      ) : suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Nearby sites</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => {
              // The site siteChoice currently points at — not necessarily
              // what the flight is bound to right now (typing a new name
              // deselects it), the same "Current" treatment the (now-hidden)
              // zone step used to give its own already-bound row.
              const isCurrent = selectedSiteId === s.id;
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-md border px-3 py-2",
                    isCurrent ? "border-amber bg-amber/10" : "border-gray-200",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="font-condensed font-bold text-ink">{s.name}</span>
                      <span className="text-xs text-gray-500">
                        {formatDistance(s.distanceM)} {formatBearing(s.bearingDeg)} · {s.kind} ·{" "}
                        {s.visibility === "public" ? "public" : "private"}
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
                        onClick={() => onReuse(s.id, s.name, s.visibility)}
                      >
                        Use this site
                      </Button>
                    )}
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
              );
            })}
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
              {pending ? "Saving…" : "Save"}
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
  onViewSiteCommunity,
  onViewZoneCommunity,
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
  /** SPRINT-007: shown whenever the site/zone is PUBLIC — independent of
   *  onedByViewer, since the flight owner may well not own the underlying
   *  public site/zone their flight happens to be bound to. */
  onViewSiteCommunity?: () => void;
  onViewZoneCommunity?: () => void;
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

      {(onViewZoneCommunity || onViewSiteCommunity) && (
        <div className="flex flex-wrap items-center gap-2">
          {onViewZoneCommunity && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onViewZoneCommunity}>
              Spot contributors &amp; endorsements
            </Button>
          )}
          {onViewSiteCommunity && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onViewSiteCommunity}>
              Site contributors &amp; endorsements
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
  // SPRINT-008: `rows.zones` is always [] when zones are disabled (the
  // server action skips the query entirely) — deriving the copy from that
  // already-gated data avoids threading yet another prop just for text.
  const hasSpots = rows !== null && rows.zones.length > 0;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">Edit a boundary</h2>
        <p className="text-sm text-gray-500">
          {hasSpots
            ? "Pick one of your sites or spots to draw or change its boundary."
            : "Pick one of your sites to draw or change its boundary."}
        </p>
      </div>

      {rows === null ? (
        <p className="text-sm text-gray-500">Loading your sites…</p>
      ) : rows.sites.length === 0 && rows.zones.length === 0 ? (
        <p className="text-sm text-gray-500">You don&rsquo;t own any named sites yet.</p>
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
