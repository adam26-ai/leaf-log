"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Keep the current section marked through client navigation and subpages. */
export function CurrentPageLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "aria-current"> & { href: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return <Link {...props} href={href} aria-current={active ? "page" : undefined} />;
}
