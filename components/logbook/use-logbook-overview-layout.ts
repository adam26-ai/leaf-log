"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Hide arrows only when the complete filter row would otherwise wrap. */
export function useLogbookOverviewLayout(ref: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({ stacked:false, compactFilters:false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const filters = element.querySelector<HTMLElement>('[aria-label="Logbook filters"]')!, stats = element.firstElementChild!;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(filters).columnGap);
      const buttons = Array.from(filters.children).map(child => child.matches('button') ? child : child.querySelector('button')!);
      const widths = buttons.map(button => {
        const arrow = button.querySelector('[data-filter-chevron]');
        const arrowWidth = arrow ? arrow.getBoundingClientRect().width + parseFloat(getComputedStyle(button).columnGap) : 0;
        const hidden = arrow && getComputedStyle(arrow).position === 'absolute';
        return { full:button.getBoundingClientRect().width + (hidden ? arrowWidth : 0), small:button.getBoundingClientRect().width - (hidden ? 0 : arrowWidth) };
      });
      const full = widths.reduce((sum, width) => sum + width.full, 0) + gap * (widths.length - 1);
      const compactFilters = full > element.clientWidth;
      const filterWidth = compactFilters ? widths.reduce((sum, width) => sum + width.small, 0) + gap * (widths.length - 1) : full;
      const stacked = stats.getBoundingClientRect().width + parseFloat(getComputedStyle(element).columnGap) + filterWidth > element.clientWidth;
      setLayout(previous => previous.stacked === stacked && previous.compactFilters === compactFilters ? previous : { stacked, compactFilters });
    };
    const observer = new ResizeObserver(measure);
    [element, filters, stats].forEach(target => observer.observe(target));
    document.fonts?.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}
