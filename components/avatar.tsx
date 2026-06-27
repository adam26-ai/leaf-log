import { cn } from "@/lib/utils";

/** Avatar serve URL (thumb or full), cache-busted by the profile's stamp. */
export function avatarUrl(
  handle: string,
  variant: "thumb" | "full",
  updatedAt: Date | string | null,
): string {
  const v = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `/api/profiles/${encodeURIComponent(handle)}/avatar?variant=${variant}&v=${v}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A pilot's avatar — the uploaded image when present, else their initials on a
 * leaf-tinted disc. Pure presentational; safe in server components.
 */
export function Avatar({
  handle,
  displayName,
  avatarUpdatedAt,
  variant = "thumb",
  className,
}: {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
  variant?: "thumb" | "full";
  className?: string;
}) {
  const base = "shrink-0 overflow-hidden rounded-full bg-leaf/15 ring-1 ring-black/5";
  if (avatarUpdatedAt) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl(handle, variant, avatarUpdatedAt)}
        alt={displayName}
        className={cn(base, "object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-label={displayName}
      className={cn(
        base,
        "flex items-center justify-center font-condensed font-bold text-leaf-strong",
        className,
      )}
    >
      {initials(displayName)}
    </div>
  );
}
