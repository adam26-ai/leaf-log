"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Sparkles, Settings, LogOut } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { signOutAction } from "@/lib/actions";
import type { Profile } from "@/lib/profile";

/** Header avatar that opens an account menu: What's new, Settings, Sign out. */
export function AvatarMenu({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2"
      >
        <Avatar
          handle={profile.handle}
          displayName={profile.displayName}
          avatarUpdatedAt={profile.avatarUpdatedAt}
          className="h-8 w-8 text-xs"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-md border border-gray-200 bg-paper py-1 shadow-lg"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="truncate font-condensed text-sm font-bold text-ink">
              {profile.displayName}
            </p>
            <p className="truncate text-xs text-gray-500">@{profile.handle}</p>
          </div>

          <MenuLink href="/whats-new" icon={<Sparkles className="h-4 w-4" />} onSelect={() => setOpen(false)}>
            What&apos;s new
          </MenuLink>
          <MenuLink href="/settings" icon={<Settings className="h-4 w-4" />} onSelect={() => setOpen(false)}>
            Settings
          </MenuLink>

          <form action={signOutAction} role="none" className="border-t border-gray-100">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onSelect,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-ink"
    >
      {icon}
      {children}
    </Link>
  );
}
