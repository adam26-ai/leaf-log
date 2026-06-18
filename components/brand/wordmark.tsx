import { cn } from "@/lib/utils";

/**
 * Leaf Log wordmark. Uses Roboto Condensed until the custom `leaf` display face
 * (leafvario.com brand asset) is licensed for web — see DESIGN.md open question.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-condensed font-bold tracking-tight text-ink select-none",
        className,
      )}
    >
      Leaf<span className="text-amber-strong">Log</span>
    </span>
  );
}
