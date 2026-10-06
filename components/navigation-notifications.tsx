"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getNavigationCounts } from "@/app/notification-actions";

const Counts = createContext({ feed: 0, friends: 0 });

export function NavigationNotifications({ children, feedSeenThrough, refreshKey }: { children: ReactNode; feedSeenThrough?: string; refreshKey: string }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState({ feed: 0, friends: 0 });
  useEffect(() => {
    let disposed = false;
    let sequence = 0;
    async function refresh(seenThrough?: string) {
      const request = ++sequence;
      try {
        const next = await getNavigationCounts(seenThrough);
        if (!disposed && request === sequence) setCounts(next);
      } catch {
        // Keep the last successful count during a temporary connection failure.
      }
    }
    void refresh(pathname === "/feed" ? feedSeenThrough : undefined);
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refreshVisible);
    const timer = window.setInterval(refreshVisible, 60_000);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refreshVisible);
      window.clearInterval(timer);
    };
  }, [pathname, feedSeenThrough, refreshKey]);
  return <Counts.Provider value={counts}>{children}</Counts.Provider>;
}

export function NavigationBadge({ kind }: { kind: "feed" | "friends" }) {
  const count = useContext(Counts)[kind];
  if (count === 0) return null;
  const description = kind === "feed"
    ? `${count} new ${count === 1 ? "flight" : "flights"}`
    : `${count} pending friend ${count === 1 ? "request" : "requests"}`;
  return <span role="status" aria-label={description} title={description}
    className="pointer-events-none absolute -right-1.5 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-brand-blue-strong bg-success-accent px-1 font-sans text-[10px] leading-none font-bold tabular-nums text-[#005a99]">
    <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
  </span>;
}
