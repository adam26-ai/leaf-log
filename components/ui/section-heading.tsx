import { cn } from "@/lib/utils";
import { AccentBar } from "./accent-bar";

/**
 * Section heading with the signature amber accent bar beneath it —
 * Roboto Condensed, the leafvario.com signage feel (DESIGN.md).
 */
export function SectionHeading({
  children,
  className,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Tag className="font-condensed font-bold tracking-tight text-ink">
        {children}
      </Tag>
      <AccentBar />
    </div>
  );
}
