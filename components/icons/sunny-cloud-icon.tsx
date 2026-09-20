import type { SVGProps } from "react";

/** Fair weather counterpart to the sign-out rain cloud. */
export function SunnyCloudIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="16" cy="10.5" r="6" />
      <path d="M16 1.5v2M7.8 4.1l1.5 1.5M24.2 4.1l-1.5 1.5M5 10.5h2M25 10.5h2M9.3 15.4l-1.5 1.5M22.7 15.4l1.5 1.5" />
      <path d="M3.5 26.5h9.2a3.8 3.8 0 0 0 .1-7.6 4.8 4.8 0 0 0-8.8 1.8 3 3 0 0 0-.5 5.8ZM19.3 26.5h9.2a3 3 0 0 0-.5-5.8 4.8 4.8 0 0 0-8.8-1.8 3.8 3.8 0 0 0 .1 7.6Z" />
    </svg>
  );
}
