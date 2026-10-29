"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { LogbookEditLink } from "./logbook-edit-link";
import css from "./logbook-overview.module.css";

export function LogbookProfileHeader({ ownerId, handle, displayName, avatarUpdatedAt, friendCount, hasFlights }: {
  ownerId: string; handle: string; displayName: string; avatarUpdatedAt: Date | string | null; friendCount: number; hasFlights: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState("full");
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !hasFlights || typeof ResizeObserver === "undefined") return;
    const avatar = element.firstElementChild!, actions = element.querySelector('[data-logbook-actions]')!;
    const edit = actions.querySelector('a[href="/logbook/edit"]')!, suffix = edit.querySelector('[data-edit-suffix]')!, add = actions.querySelector('a[href="/upload"]')!;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(element).columnGap), actionGap = parseFloat(getComputedStyle(actions).gap);
      const suffixWidth = suffix.getBoundingClientRect().width;
      const fullEdit = edit.getBoundingClientRect().width + (getComputedStyle(suffix).position === "absolute" ? suffixWidth : 0);
      const identity = parseFloat(getComputedStyle(element).getPropertyValue('--identity-preferred'));
      const fullWidth = avatar.getBoundingClientRect().width + identity + 2 * gap + fullEdit + actionGap + add.getBoundingClientRect().width;
      const next = fullWidth <= element.clientWidth ? "full" : fullWidth - suffixWidth <= element.clientWidth ? "short" : "stacked";
      setMode(previous => previous === next ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    [element, avatar, suffix, add].forEach(target => observer.observe(target));
    document.fonts?.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [hasFlights]);

  return <div ref={root} className={css.profile} data-logbook-profile data-action-layout={mode}>
    <Avatar handle={handle} displayName={displayName} avatarUpdatedAt={avatarUpdatedAt} variant="full" className="h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl" />
    <div className={css.identity} data-logbook-identity>
      <h1 className="break-words font-condensed text-2xl font-bold tracking-tight text-ink sm:text-3xl">{displayName}</h1>
      <p className="text-sm text-gray-500"><span className="break-all font-mono text-lg sm:text-xl">@{handle}</span><span className="mx-2 text-gray-300" aria-hidden="true">·</span>{friendCount} {friendCount === 1 ? "friend" : "friends"}</p>
    </div>
    <div className={css.profileActions} data-logbook-actions>
      {hasFlights && <LogbookEditLink ownerId={ownerId} />}
      <Button asChild size="sm"><Link href="/upload">Add flight</Link></Button>
    </div>
  </div>;
}
