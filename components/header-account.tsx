"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { Avatar } from "@/components/avatar";

export function HeaderAccount({ handle, displayName, avatarUpdatedAt }: {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState({ name: false, small: false });

  useLayoutEffect(() => {
    const link = linkRef.current;
    const name = nameRef.current;
    const header = link?.parentElement;
    const navigation = link?.previousElementSibling;
    if (!link || !name || !header || !navigation) return;
    const measure = () => {
      const style = getComputedStyle(header);
      const available = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        - navigation.getBoundingClientRect().width - parseFloat(style.columnGap || "0");
      const next = { name: available >= 44 + 8 + name.getBoundingClientRect().width, small: available < 44 };
      setFit(previous => previous.name === next.name && previous.small === next.small ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(navigation);
    observer.observe(name);
    measure();
    return () => observer.disconnect();
  }, []);

  return <Link ref={linkRef} href="/settings" aria-label="Settings" title="Settings"
    className="group relative ml-auto flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2">
    <span ref={nameRef} aria-hidden={!fit.name} className={`w-max shrink-0 text-right ${fit.name ? "" : "pointer-events-none invisible absolute right-full"}`}>
      <span className="block max-w-32 truncate font-condensed text-sm font-bold text-ink">{displayName}</span>
      <span className="block max-w-32 truncate text-xs text-gray-500">@{handle}</span>
    </span>
    <span className="relative block">
      <Avatar handle={handle} displayName={displayName} avatarUpdatedAt={avatarUpdatedAt} className={`${fit.small ? "h-9 w-9" : "h-11 w-11"} text-sm`} />
      <span className="absolute inset-0 grid place-items-center rounded-full bg-white/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Settings aria-hidden="true" className="h-7 w-7 text-ink opacity-60" />
      </span>
    </span>
  </Link>;
}
