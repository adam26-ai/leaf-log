import type { SVGProps } from "react";

/** Fair weather counterpart to the sign-out rain cloud. */
export function SunnyCloudIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 13a5.5 5.5 0 1 1 10 5M22 2v2M29.1 4.9l-1.4 1.4M30 12h-2M14.9 4.9l1.4 1.4" />
      <path d="M7 27a4.5 4.5 0 0 1-.4-9 5.4 5.4 0 0 1 7.1-3.9 6.2 6.2 0 0 1 11.8 2.4 5.3 5.3 0 0 1-.7 10.5Z" />
    </svg>
  );
}
