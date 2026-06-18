import { cn } from "@/lib/utils";

/**
 * The signature Leaf cue: a 3px amber bar — carried over from leafvario.com's
 * under-heading accent (DESIGN.md). The single most recognizable brand motif.
 * Kept sharp-cornered on purpose, even though the rest of the UI softens corners.
 */
export function AccentBar({
  className,
  width = "2.5rem",
}: {
  className?: string;
  width?: string | number;
}) {
  return (
    <span
      aria-hidden
      className={cn("block h-[3px] bg-amber", className)}
      style={{ width }}
    />
  );
}
