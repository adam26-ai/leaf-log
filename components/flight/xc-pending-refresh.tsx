"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function XcPendingRefresh({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
