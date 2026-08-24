"use client";

/**
 * SPRINT-007: the public/read-first community dialog for a PUBLIC site or
 * zone — reachable by ANY viewer (including one who doesn't own the flight
 * they clicked the label on, and including anonymous viewers, read-only)
 * from a clickable site/zone label. This is deliberately separate from
 * NameSiteDialog: binding a different site to ONE's OWN flight stays
 * flight-owner-only (unchanged); editing a public site/zone's own name or
 * boundary is a different action, open to any signed-in, onboarded pilot
 * regardless of whose flight they reached it from.
 */
import { useEffect, useState } from "react";
import {
  getCommunityInfoForRow,
  renamePublicRow,
  toggleEndorsement,
  type CommunityActionResult,
} from "@/app/flights/[id]/community-action";
import {
  getBoundaryForPublicRow,
  saveBoundaryForOwnedRow,
  clearBoundaryForOwnedRow,
  type BoundaryEditorInitialState,
} from "@/app/flights/[id]/boundary-action";
import type { LocationCommunityInfo } from "@/lib/sites/community";
import type { BoundaryLevel } from "@/lib/sites/boundary";
import type { SiteEndpoint } from "@/lib/sites/associate";
import { radiusForKind, zoneRadiusForKind } from "@/lib/sites/geo";
import { Button } from "@/components/ui/button";
import { BoundaryEditor } from "@/components/flight/boundary-editor";

function relativeTime(d: Date): string {
  const seconds = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function describeAudit(entry: LocationCommunityInfo["recentAudit"][number]): string {
  const who = entry.actor ? entry.actor.displayName : "a deleted pilot";
  const detail = (entry.detail ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "create":
      return `${who} created this`;
    case "published":
      return `${who} made this public`;
    case "renamed":
      return `${who} renamed this from "${String(detail.from ?? "")}" to "${String(detail.to ?? "")}"`;
    case "boundary_set":
      return `${who} set a boundary (${String(detail.vertexCount ?? "?")} points)`;
    case "boundary_cleared":
      return `${who} cleared the boundary`;
    case "merge":
      return `${who} merged another location into this one`;
    default:
      return `${who} made a change`;
  }
}

export function LocationCommunityDialog({
  level,
  id,
  name,
  endpoint,
  onClose,
}: {
  level: BoundaryLevel;
  id: string;
  name: string;
  endpoint: SiteEndpoint;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<LocationCommunityInfo | null | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(name);
  const [editingBoundary, setEditingBoundary] = useState(false);
  const [boundaryState, setBoundaryState] = useState<BoundaryEditorInitialState | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommunityInfoForRow(level, id).then((result) => {
      if (!cancelled) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, [level, id]);

  function reportResult(result: CommunityActionResult) {
    if (result.ok) {
      setError(null);
      getCommunityInfoForRow(level, id).then(setInfo);
    } else {
      setError(result.error);
    }
  }

  async function handleRename() {
    setPending(true);
    const result = await renamePublicRow(level, id, nameInput);
    setPending(false);
    reportResult(result);
    if (result.ok) setEditingName(false);
  }

  async function handleEndorse() {
    setPending(true);
    const result = await toggleEndorsement(level, id);
    setPending(false);
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      getCommunityInfoForRow(level, id).then(setInfo);
    }
  }

  async function openBoundaryEditor() {
    setError(null);
    const state = await getBoundaryForPublicRow(level, id);
    setBoundaryState(state);
    setEditingBoundary(true);
  }

  if (editingBoundary && boundaryState) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={() => setEditingBoundary(false)}>
        <div
          className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg bg-paper p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">Boundary for &ldquo;{name}&rdquo;</h2>
          <BoundaryEditor
            anchor={boundaryState.anchor}
            initialBoundary={boundaryState.boundary}
            level={level}
            referenceRadiusM={level === "site" ? radiusForKind(endpoint) : zoneRadiusForKind(endpoint)}
            nearby={boundaryState.nearby}
            onSave={(raw) => saveBoundaryForOwnedRow(level, id, raw)}
            onClear={() => clearBoundaryForOwnedRow(level, id)}
            onCancel={() => setEditingBoundary(false)}
            onSaved={() => {
              setEditingBoundary(false);
              getCommunityInfoForRow(level, id).then(setInfo);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-condensed text-xl font-bold tracking-tight text-ink">{name}</h2>
            <p className="text-xs text-gray-500">Public {level} — community owned</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-ink">
            Close
          </button>
        </div>

        {info === undefined && <p className="text-sm text-gray-500">Loading…</p>}
        {info === null && <p className="text-sm text-gray-500">Not available.</p>}

        {info && (
          <>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleEndorse}>
                {info.endorsement.hasEndorsed ? "Endorsed ✓" : "Endorse"}
              </Button>
              <span className="text-sm text-gray-600">
                {info.endorsement.count} endorsement{info.endorsement.count === 1 ? "" : "s"}
              </span>
            </div>

            {info.contributors.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Contributors</p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700">
                  {info.contributors.map((c, i) => (
                    <li key={c.profileId}>
                      {c.displayName}
                      {i === 0 && <span className="text-gray-400"> (creator)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {editingName ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={60}
                    disabled={pending}
                    className="h-10 rounded-md border border-gray-300 bg-paper px-3 text-sm text-ink outline-none focus:border-amber"
                  />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={pending} onClick={handleRename}>
                      Save name
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditingName(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingName(true)}>
                    Rename
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={openBoundaryEditor}>
                    Redraw boundary
                  </Button>
                </div>
              )}
              <p className="text-xs text-gray-500">
                This is a public {level} — any signed-in pilot can fix its name or shape.
              </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="text-xs text-gray-500 underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                {historyOpen ? "Hide history" : "Show history"}
              </button>
              {historyOpen && (
                <ul className="mt-2 flex flex-col gap-1.5 text-xs text-gray-600">
                  {info.recentAudit.length === 0 && <li className="text-gray-400">No history yet.</li>}
                  {info.recentAudit.map((entry) => (
                    <li key={entry.id}>
                      {describeAudit(entry)} — {relativeTime(entry.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
