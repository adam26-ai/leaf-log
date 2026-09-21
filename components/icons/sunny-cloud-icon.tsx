import type { SVGProps } from "react";

/** Fair weather counterpart to the sign-out rain cloud. */
export function SunnyCloudIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10" cy="9.5" r="5.25" />
      <path d="M10 1v2M3.8 3.3l1.5 1.5M1.5 9.5h2M3.8 15.7l1.5-1.5M10 16v2M16.2 3.3l-1.5 1.5M16.5 9.5h2" />
      <path d="M12 27.5a3.6 3.6 0 0 1-.2-7.2 4.8 4.8 0 0 1 9.1-1.6 4.4 4.4 0 1 1 4.7 8.8Z" />
    </svg>
  );
}
