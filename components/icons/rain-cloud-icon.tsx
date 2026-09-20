import type { SVGProps } from "react";

/** A rounded rain cloud with a closed base and slanting showers. */
export function RainCloudIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.4-9 5.4 5.4 0 0 1 7.1-3.9A6.2 6.2 0 0 1 25.5 8a5.3 5.3 0 0 1-.7 10.5Z" />
      <path d="m10 22-1.8 4.8M13.4 21l-3.1 8.3M16 22l-1.8 4.8M19.3 21.5l-2.1 5.7M22.6 21l-3 8M25 22.8l-1.3 3.5" />
    </svg>
  );
}
