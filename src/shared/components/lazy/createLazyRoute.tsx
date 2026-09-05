// src/shared/components/lazy/createLazyRoute.tsx
//
// SECURITY CONSTRAINT — lazy loading is NOT an authorization control.
// Code splitting here is a delivery-hygiene and performance measure only.
// Feature_Chunk URLs remain fetchable by any authenticated client that
// discovers them. Backend authorization remains the authoritative access
// control for sensitive operations and data. Follow-up spec
// "reconciliation-backend-migration" moves sensitive business logic
// server-side.

import { Suspense, lazy, useRef, useState } from "react";
import type { ComponentType } from "react";
import SuspenseFallback from "./SuspenseFallback";
import ChunkErrorBoundary from "./ChunkErrorBoundary";

type Loader = () => Promise<{ default: ComponentType }>;

/**
 * Wraps a dynamic import in a retry-capable lazy boundary.
 * MUST be called at module scope only (never inside a render), so the
 * returned component identity is stable across renders.
 */
export function createLazyRoute(load: Loader): ComponentType {
  return function LazyRoute() {
    // attempt increments on retry; each attempt gets a FRESH React.lazy
    // instance because React.lazy caches a rejected loader promise forever.
    const [attempt, setAttempt] = useState(0);
    const lazyRef = useRef<{ attempt: number; Comp: ComponentType } | null>(
      null,
    );
    if (lazyRef.current === null || lazyRef.current.attempt !== attempt) {
      lazyRef.current = { attempt, Comp: lazy(load) };
    }
    const Comp = lazyRef.current.Comp;
    return (
      // key remounts the boundary on retry, clearing its error state (3.4);
      // route unmount on navigation discards ALL of this state, so
      // re-entering the route starts from attempt 0 with a fresh lazy (3.10)
      <ChunkErrorBoundary
        key={attempt}
        attempt={attempt}
        onRetry={() => setAttempt((a) => a + 1)}
      >
        <Suspense fallback={<SuspenseFallback />}>
          <Comp />
        </Suspense>
      </ChunkErrorBoundary>
    );
  };
}
