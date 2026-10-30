"use client";

import { lazy, Suspense, type ComponentProps } from "react";
import type { BoundaryEditor as Editor } from "./boundary-editor";
import type { SiteAreaMap as AreaMap } from "./site-area-map";

function LoadingMap() {
  return <div role="status" className="flex h-64 items-center justify-center rounded-md bg-gray-50 text-sm text-gray-500">Loading map…</div>;
}

// Logbooks and imports can edit text without loading WebGL. Load the map only
// when its dialog/editor is actually rendered, retaining the same components.
const LazyBoundaryEditor = lazy(() => import("./boundary-editor").then(module => ({ default: module.BoundaryEditor })));
const LazySiteAreaMap = lazy(() => import("./site-area-map").then(module => ({ default: module.SiteAreaMap })));

// React.lazy preserves the editor's imperative ref (readDraft/readGeometry).
export function BoundaryEditor(props: ComponentProps<typeof Editor>) {
  return <Suspense fallback={<LoadingMap />}><LazyBoundaryEditor {...props} /></Suspense>;
}
export function SiteAreaMap(props: ComponentProps<typeof AreaMap>) {
  return <Suspense fallback={<LoadingMap />}><LazySiteAreaMap {...props} /></Suspense>;
}
