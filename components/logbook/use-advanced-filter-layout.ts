"use client";

import { useEffect, useState, type RefObject } from "react";

const sortedKeys = ["dates", "sites", "wings", "maxAltitude", "maxClimb", "xc"];
const namedKeys = [...sortedKeys, "visibility", "notes"];

/** Measure actual button text so labels disappear only when they no longer fit. */
export function useAdvancedFilterLayout(ref: RefObject<HTMLDivElement | null>) {
  const [compactKeys, setCompactKeys] = useState<string[]>([]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    const fit = () => {
      if (!active) return;
      const styles = getComputedStyle(element), gap = parseFloat(styles.columnGap) || 0;
      const tail = element.querySelector<HTMLElement>('[data-trailing-filters]')!;
      const tailStyles = getComputedStyle(tail), tailGap = parseFloat(tailStyles.columnGap) || 0;
      const separateTail = tailStyles.gridColumnStart === '2';
      const stackedTail = tailStyles.gridTemplateAreas.split('"').filter(row => row.trim()).length > 1;
      const widths = new Map(Array.from(element.querySelectorAll<HTMLElement>('[data-filter-key]')).map(category => {
        const key = category.dataset.filterKey!;
        const button = category.querySelector<HTMLElement>('button')!;
        const label = button.querySelector<HTMLElement>('[data-filter-label]');
        const labelSpace = label ? label.getBoundingClientRect().width + (parseFloat(getComputedStyle(button).columnGap) || 0) : 0;
        const compact = category.dataset.compact === 'true';
        return [key, { full: button.getBoundingClientRect().width + (compact ? labelSpace : 0), small: button.getBoundingClientRect().width - (compact ? 0 : labelSpace) }] as const;
      }));
      const hidden: string[] = [];
      const requiredWidth = () => {
        const width = (key: string) => widths.get(key)![hidden.includes(key) ? 'small' : 'full'];
        const sortedWidth = sortedKeys.reduce((sum, key) => sum + width(key), 0);
        const tailWidth = stackedTail
          ? Math.max(width('friends'), width('visibility')) + Math.max(width('trophies'), width('notes')) + width('source') + 2 * tailGap
          : ['friends', 'trophies', 'visibility', 'notes', 'source'].reduce((sum, key) => sum + width(key), 0) + 4 * tailGap;
        const labels = element.firstElementChild!.getBoundingClientRect().width;
        return separateTail ? Math.max(labels + sortedWidth + 7 * gap, labels + tailWidth + gap) : labels + sortedWidth + tailWidth + 7 * gap;
      };
      for (const key of [...namedKeys].reverse()) {
        if (requiredWidth() <= element.clientWidth - 1) break;
        hidden.push(key);
      }
      setCompactKeys(previous => previous.join() === hidden.join() ? previous : hidden);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    document.fonts.ready.then(fit);
    return () => { active = false; observer.disconnect(); };
  }, [ref]);
  return { compactKeys };
}
