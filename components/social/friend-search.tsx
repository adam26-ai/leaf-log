"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { searchPilotsAction } from "@/app/friends/search-action";
import { Avatar } from "@/components/avatar";
import { FriendButton } from "@/components/social/friend-button";
import { cn } from "@/lib/utils";
import type { SearchPilotResult } from "@/lib/social/friends";

export function FriendSearch() {
  const router = useRouter();
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchPilotResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmedQuery = query.trim();
  const showDropdown = open && trimmedQuery.length >= 2;
  const activeResult =
    activeIndex >= 0 && activeIndex < results.length ? results[activeIndex] : null;

  function runSearch(trimmed: string) {
    const seq = (requestSeq.current += 1);

    setOpen(true);
    setLoading(true);
    setHasSearched(false);
    setActiveIndex(-1);

    searchPilotsAction(trimmed)
      .then((nextResults) => {
        if (seq !== requestSeq.current) return;
        setResults(nextResults);
        setHasSearched(true);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setResults([]);
        setHasSearched(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }

  function updateQuery(value: string) {
    const trimmed = value.trim();
    setQuery(value);

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (trimmed.length < 2) {
      requestSeq.current += 1;
      setOpen(false);
      setResults([]);
      setLoading(false);
      setHasSearched(false);
      setActiveIndex(-1);
      return;
    }

    debounceRef.current = window.setTimeout(() => runSearch(trimmed), 250);
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length === 0 ? -1 : current >= results.length - 1 ? 0 : current + 1,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length === 0 ? -1 : current <= 0 ? results.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeResult) {
      event.preventDefault();
      setOpen(false);
      router.push(`/@${activeResult.handle}`);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label
        htmlFor={inputId}
        className="font-condensed text-lg font-bold text-ink"
      >
        Find pilots
      </label>
      <div className="mt-3">
        <input
          id={inputId}
          type="search"
          value={query}
          placeholder="Search by name or @handle"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={activeResult ? `${listboxId}-${activeResult.id}` : undefined}
          aria-autocomplete="list"
          onFocus={() => {
            if (trimmedQuery.length >= 2) setOpen(true);
          }}
          onChange={(event) => {
            updateQuery(event.target.value);
          }}
          onKeyDown={handleInputKeyDown}
          className="h-11 w-full rounded-md border border-gray-300 bg-paper px-4 font-mono text-sm text-ink outline-none transition-colors placeholder:text-gray-400 focus:border-amber focus:ring-2 focus:ring-amber/30"
        />
      </div>

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-2 max-h-96 w-full overflow-y-auto rounded-md border border-gray-200 bg-paper shadow-lg ring-1 ring-black/5"
        >
          {loading && (
            <div className="px-4 py-3 text-sm text-gray-600">Searching...</div>
          )}

          {!loading && hasSearched && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-600">No pilots found</div>
          )}

          {!loading && results.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {results.map((result, index) => (
                <li
                  id={`${listboxId}-${result.id}`}
                  key={result.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3",
                    index === activeIndex && "bg-amber/10",
                  )}
                >
                  <Link
                    href={`/@${result.handle}`}
                    onClick={() => setOpen(false)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                  >
                    <Avatar
                      handle={result.handle}
                      displayName={result.displayName}
                      avatarUpdatedAt={result.avatarUpdatedAt}
                      className="h-10 w-10 text-sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-condensed text-sm font-bold text-ink">
                        {result.displayName}
                      </span>
                      <span className="block truncate font-mono text-xs text-gray-500">
                        @{result.handle}
                      </span>
                    </span>
                  </Link>
                  <div className="shrink-0">
                    <FriendButton
                      targetHandle={result.handle}
                      initialState={result.state}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
