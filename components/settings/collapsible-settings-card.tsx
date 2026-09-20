"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Deliberately varied, but stable across renders and expansion.
const cardTints: Record<string, [number, number]> = {
  Profile: [0.14, 0.06],
  "My Wings": [0.05, 0.28],
  Logbook: [0.10, 0.13],
  Replay: [0.18, 0.04],
  Devices: [0.04, 0.38],
};
const circleClassName = "grid h-14 w-14 shrink-0 place-items-center rounded-full border border-gray-300 bg-white shadow-sm";

export function CollapsibleSettingsCard({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const [blue, green] = cardTints[title] ?? [0.10, 0.10];

  return (
    <Card className={cn("overflow-hidden transition-colors", expanded && "border-gray-300", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${title} settings`}
        onClick={() => setExpanded((value) => !value)}
        style={{ backgroundImage: `linear-gradient(110deg, rgb(0 153 255 / ${blue}), rgb(148 233 30 / ${green}))` }}
        className="flex min-h-24 w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue sm:px-6"
      >
        <span className={cn(circleClassName, "text-brand-blue-strong")}>
          {icon}
        </span>
        <span role="heading" aria-level={2} className="min-w-0 flex-1 font-condensed text-xl font-bold text-ink">
          {title}
        </span>
        <span className={cn(circleClassName, "text-gray-600")} aria-hidden="true">
          {expanded ? <ChevronUp className="h-6 w-6" /> : <ChevronDown className="h-6 w-6" />}
        </span>
      </button>
      <div id={contentId} hidden={!expanded} className="border-t border-gray-200 px-5 pb-6 pt-5 sm:px-6">
        {children}
      </div>
    </Card>
  );
}
