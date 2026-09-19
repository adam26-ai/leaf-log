import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/** User-supplied paraglider #4, scaled from its original 960-unit artwork. */
export const WingIcon = forwardRef<SVGSVGElement, LucideProps>(function WingIcon(
  { size = 24, color = "currentColor", strokeWidth = 1.5, ...props }, ref,
) {
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <g transform="scale(0.025)">
      <path strokeWidth={Number(strokeWidth) * 40} d="M101.6,418.4c-13.5,12.5-35.3,5.9-39.7-12-23.7-95.6,133.5-246.5,418.1-246.5s448.6,148.2,423.9,242.1c-5.5,20.7-31.5,27.8-46.8,12.8-169.3-166.8-556.5-180.4-755.5,3.6Z"/>
      <ellipse fill={color} stroke="none" cx="476.8" cy="711.9" rx="37.3" ry="45.5"/>
      <g strokeWidth="22">
        <line x1="249" y1="528.8" x2="425.6" y2="756.8"/>
        <line x1="378" y1="480" x2="425.6" y2="756.8"/>
        <line x1="67" y1="437.2" x2="249" y2="533"/>
        <line x1="249" y1="528.8" x2="208" y2="362"/>
        <line x1="292" y1="336" x2="378" y2="480"/>
        <line x1="378" y1="480" x2="413.2" y2="308"/>
      </g>
      <g strokeWidth="22">
        <line x1="528" y1="757.4" x2="704.6" y2="529.4"/>
        <line x1="528" y1="757.4" x2="575.6" y2="480.6"/>
        <line x1="704.6" y1="533.6" x2="886.6" y2="437.8"/>
        <line x1="745.6" y1="362.6" x2="704.6" y2="529.4"/>
        <line x1="575.6" y1="480.6" x2="661.6" y2="336.6"/>
        <line x1="540.3" y1="308.6" x2="575.6" y2="480.6"/>
      </g>
      <ellipse fill={color} stroke="none" cx="476.8" cy="815" rx="75" ry="55"/>
    </g>
  </svg>;
});
