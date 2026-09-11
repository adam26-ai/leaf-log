"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function XcPendingRefresh({ pending, onRefresh }: { pending: boolean; onRefresh?: () => void }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") (onRefresh ?? router.refresh)();
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, router, onRefresh]);
  return null;
}
