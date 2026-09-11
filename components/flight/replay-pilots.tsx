"use client";

import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { ReplayPilot } from "@/lib/flights/group-replay";
import type { useGroupReplay } from "./use-group-replay";

const cardStyle = {
  background:
    "color-mix(in srgb, var(--replay-group-card-bg) calc(var(--replay-group-card-alpha) * 100%), transparent)",
};

export function ReplayPilots({
  group,
  primaryOwnerId,
  viewerId,
  onSelect,
  onToggle,
}: {
  group: ReturnType<typeof useGroupReplay>;
  primaryOwnerId: string;
  viewerId: string | null;
  onSelect: (pilot: ReplayPilot, flightId?: string) => void;
  onToggle: (pilotId: string) => void;
}) {
  const primary =
    group.pilots.find((pilot) => pilot.id === primaryOwnerId) ?? group.pilots[0];
  const friends = group.pilots.filter((pilot) => pilot.id !== primaryOwnerId);
  const friendsVisible = friends.some((pilot) => group.isVisible(pilot.id));

  function setFriendsVisible(visible: boolean) {
    friends.forEach((pilot) => {
      if (group.isVisible(pilot.id) !== visible) onToggle(pilot.id);
    });
  }

  if (!primary) return null;

  const primarySelected = group.selected?.owner.id === primary.id;

  return (
    <div className="absolute right-2 top-2 z-20 flex max-h-[calc(100%-58px)] w-20 flex-col gap-2 text-[var(--replay-group-card-text)] sm:top-3 sm:max-h-[calc(100%-70px)] sm:w-40">
      <section
        aria-label="Primary flight pilot"
        className="shrink-0 rounded-lg p-1.5 shadow-md backdrop-blur-sm sm:p-2"
        style={cardStyle}
      >
        <button
          type="button"
          onClick={() => onSelect(primary)}
          aria-label={`Follow ${primary.displayName}`}
          aria-pressed={primarySelected}
          title={`${primary.displayName} · Primary flight`}
          className="flex w-full min-w-0 flex-col items-center gap-1 rounded-md p-1 hover:bg-[var(--replay-group-card-hover)] sm:flex-row sm:items-start"
        >
          <span
            className={`block shrink-0 rounded-full border-[3px] ${primarySelected ? "outline-2 outline-offset-1" : ""}`}
            style={{
              borderColor: "var(--replay-group-primary)",
              outlineColor: "var(--replay-group-primary)",
            }}
          >
            <Avatar
              {...primary}
              className="h-8 w-8 bg-[var(--replay-group-avatar-bg)] text-xs text-[var(--replay-group-avatar-text)]"
            />
          </span>
          <span className="min-w-0 flex-1 text-center text-[13px] font-semibold leading-tight sm:text-left sm:text-sm">
            <span className="line-clamp-3 block whitespace-normal break-words">
              {primary.displayName}
            </span>
            {primary.id === viewerId && (
              <span className="mt-1 block whitespace-nowrap text-center text-xs font-medium">
                * You *
              </span>
            )}
          </span>
        </button>
      </section>

      {(viewerId || friends.length > 0) && (
        <section
          aria-label="Friends in this replay"
          className="min-h-0 overflow-y-auto rounded-lg p-1.5 shadow-md backdrop-blur-sm sm:p-2"
          style={cardStyle}
        >
          <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-center">
            <span className="text-[13px] font-semibold sm:text-sm">Friends</span>
            <div className="flex items-center justify-center gap-1">
              {friends.length > 0 && (
                <button
                  type="button"
                  aria-label={friendsVisible ? "Hide friends" : "Show friends"}
                  aria-pressed={friendsVisible}
                  title={friendsVisible ? "Hide friends" : "Show friends"}
                  onClick={() => setFriendsVisible(!friendsVisible)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-[var(--replay-group-card-hover)] sm:h-9 sm:w-9"
                >
                  {friendsVisible ? (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}
              {viewerId && (
                <button
                  type="button"
                  aria-label="Refresh friends"
                  title={
                    group.discoveryError
                      ? "Could not find friends' flights. Try again."
                      : "Refresh nearby friends' flights"
                  }
                  disabled={group.discovering}
                  onClick={() => void group.discover()}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-[var(--replay-group-card-hover)] disabled:opacity-60 sm:h-9 sm:w-9"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${group.discovering ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>
          </div>
          <span role="status" className="sr-only">
            {group.discoveryError
              ? "Could not refresh friends"
              : group.discovering
                ? "Finding nearby flights"
                : ""}
          </span>

          {friendsVisible && friends.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-current/15 pt-2">
              {friends.map((pilot) => {
                const selected = group.selected?.owner.id === pilot.id;
                const loading = !group.flights.some(
                  (flight) => flight.owner.id === pilot.id,
                );
                const failed = group.candidates
                  .filter((flight) => flight.owner.id === pilot.id)
                  .some((flight) => group.failures.includes(flight.id));

                return (
                  <button
                    key={pilot.id}
                    type="button"
                    onClick={() => onSelect(pilot)}
                    aria-label={`Follow ${pilot.displayName}`}
                    aria-pressed={selected}
                    title={pilot.displayName}
                    className="flex min-w-0 flex-col items-center gap-1 rounded-md p-1 hover:bg-[var(--replay-group-card-hover)] sm:flex-row sm:items-start sm:gap-2"
                  >
                    <span
                      className={`block shrink-0 rounded-full border-[3px] ${selected ? "outline-2 outline-offset-1" : ""}`}
                      style={{
                        borderColor: "var(--replay-group-companion)",
                        outlineColor: "var(--replay-group-companion)",
                      }}
                    >
                      <Avatar
                        {...pilot}
                        className="h-8 w-8 bg-[var(--replay-group-avatar-bg)] text-xs text-[var(--replay-group-avatar-text)]"
                      />
                    </span>
                    <span className="min-w-0 flex-1 text-center sm:text-left">
                      <span className="line-clamp-3 block whitespace-normal break-words text-[13px] font-semibold leading-tight sm:text-sm">
                        {pilot.displayName}
                      </span>
                      {loading && (
                        <span className="mt-0.5 block text-xs leading-tight text-[var(--replay-group-card-muted)]">
                          {failed ? "Unavailable" : "Loading…"}
                        </span>
                      )}
                      {pilot.id === viewerId && (
                        <span className="mt-1 block whitespace-nowrap text-center text-xs font-medium">
                          * You *
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {group.nextCursor && (
            <button
              type="button"
              disabled={group.discovering}
              onClick={() => void group.discover(true)}
              className="mt-2 w-full rounded py-1.5 text-xs underline hover:bg-[var(--replay-group-card-hover)] disabled:opacity-60"
            >
              Find more flights
            </button>
          )}
          {(group.failures.length > 0 || group.photoFailures.length > 0) && (
            <button
              type="button"
              onClick={group.retry}
              className="mt-1 w-full rounded py-1.5 text-xs underline hover:bg-[var(--replay-group-card-hover)]"
            >
              Retry flight / photos
            </button>
          )}
        </section>
      )}
    </div>
  );
}
