import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const markSizes = {
  sm: "h-5 w-5 [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-8 w-8 [&_svg]:h-5 [&_svg]:w-5",
  lg: "h-12 w-12 [&_svg]:h-7 [&_svg]:w-7",
} as const;

export function SuccessMark({
  size = "sm",
  className,
}: {
  size?: keyof typeof markSizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-success-surface text-success-accent",
        markSizes[size],
        className,
      )}
    >
      <Check strokeWidth={3.25} />
    </span>
  );
}

export function SuccessStatus({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      role="status"
      className={cn("inline-flex items-center gap-1.5 text-sm font-medium text-gray-700", className)}
    >
      <SuccessMark />
      {children}
    </span>
  );
}
