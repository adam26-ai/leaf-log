"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LogbookEditLink({ ownerId }: { ownerId: string }) {
  return <Button asChild variant="outline" size="sm"><Link href="/logbook/edit" aria-label="Edit logbook" title="Edit logbook" prefetch={false} onClick={() => {
    try {
      const list = document.querySelector<HTMLElement>("[data-logbook-flights]");
      sessionStorage.setItem(`leaf-logbook-origin-scroll:${ownerId}`, String(list?.scrollTop ?? 0));
      const listTop = list?.getBoundingClientRect().top ?? 0;
      const anchor = [...document.querySelectorAll<HTMLAnchorElement>("[data-logbook-flights] a[href^='/flights/']")].find(row => row.getBoundingClientRect().bottom > listTop + 1);
      if (anchor) sessionStorage.setItem(`leaf-logbook-anchor:${ownerId}`, anchor.getAttribute("href")!.split("/").pop()!);
    } catch { /* Editing remains available with browser storage disabled. */ }
  }}><Pencil className="h-4 w-4" aria-hidden="true" /><span>Edit<span data-edit-suffix> logbook</span></span></Link></Button>;
}
