"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT_EXT = /\.(jpe?g|png|heic|heif)$/i;

/** Owner avatar upload/remove — drag-drop or click, with live preview. */
export function AvatarUploader({
  handle,
  displayName,
  avatarUpdatedAt,
}: {
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAvatar = !!avatarUpdatedAt;

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !ACCEPT_EXT.test(file.name)) {
      setError("Please choose a JPEG, PNG, or HEIC image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      if (res.ok) {
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Upload failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (res.ok) router.refresh();
      else setError("Could not remove avatar.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <Avatar
        handle={handle}
        displayName={displayName}
        avatarUpdatedAt={avatarUpdatedAt}
        variant="full"
        className="h-20 w-20 text-2xl"
      />
      <div className="flex flex-col gap-2">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-5 py-3 text-center transition-colors",
            dragging ? "border-amber bg-amber/10" : "border-gray-300 hover:border-amber",
            busy && "pointer-events-none opacity-50",
          )}
        >
          <span className="font-condensed text-sm font-bold text-ink">
            {busy ? "Uploading…" : hasAvatar ? "Change photo" : "Add a photo"}
          </span>
          <span className="text-xs text-gray-500">
            Drag &amp; drop or click · JPEG, PNG, or HEIC
          </span>
        </div>
        {hasAvatar && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={remove}
            className="w-fit text-gray-500"
          >
            Remove photo
          </Button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
        hidden
        onChange={(e) => upload(e.target.files?.[0] ?? undefined)}
      />
    </div>
  );
}
