/** Small flight silhouettes: a mountain launch and a flat landing field. */
export function SiteUseIcon({ landing = false }: { landing?: boolean }) {
  return <svg viewBox="0 0 32 28" className="h-5 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 7 Q23 0 29 7 Q23 4 17 7 Z M18 7 L23 13 L28 7 M23 13 L22 16 L25 17" />
    {landing ? <><path d="M3 22 H29 M5 26 H27 M8 22 L6 26 M16 22 V26 M24 22 L26 26" /></>
      : <><path d="M2 26 L11 11 L20 26 H30 M7 18 L11 20 L14 17" /></>}
  </svg>;
}
