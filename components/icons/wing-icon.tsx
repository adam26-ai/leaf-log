import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/** Front view of an arched paraglider canopy, ribs and suspension lines. */
export const WingIcon = forwardRef<SVGSVGElement, LucideProps>(function WingIcon(
  { size = 24, color = "currentColor", strokeWidth = 1.5, ...props }, ref,
) {
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M2 11C3.6 6 7.5 4 12 4s8.4 2 10 7C16.5 8 7.5 8 2 11Z" />
    <path d="m7 5-1 4.5M12 4v4.7m5-3.7 1 4.5M3 11l8 8m10-8-8 8M7 9.5l4.5 9.5M17 9.5 12.5 19" strokeWidth="0.9" />
    <circle cx="12" cy="20" r="1.2" fill={color} stroke="none" />
  </svg>;
});
