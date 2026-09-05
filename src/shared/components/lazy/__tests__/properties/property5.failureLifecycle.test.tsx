// Feature: feature-code-splitting, Property 5: Failure lifecycle — any load failure yields the Chunk_Error_View and no partial content
//
// For any Feature_Module, any error value, and either failure mode (the
// dynamic import rejects, or the imported module throws during
// evaluation/initial render), the route content area shows the
// Chunk_Error_View — with neither the Suspense_Fallback nor any
// Feature_Module content — and the application remains on the current route.
//
// **Validates: Requirements 1.8, 2.7, 3.3, 3.8**

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ComponentType, ReactNode } from "react";
import { createLazyRoute } from "../../createLazyRoute";

const ROUTE_PATH = "/feature-route";

/** Records the current pathname so we can assert the route is unchanged. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

/** Feature component that throws its error value during the initial render. */
function Thrower({ error }: { error: unknown }): ReactNode {
  throw error;
}

// ── Generators ─────────────────────────────────────────────────────────

/**
 * Arbitrary error values: Error objects, plain strings, and falsy values
 * ("", 0, null, undefined, false, NaN) — a dynamic import can reject with
 * (and a module can throw) ANY value, and the Chunk_Error_View must appear
 * regardless (Req 1.8, 3.3).
 */
const errorValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.string().map((msg) => new Error(msg)),
  fc.constantFrom<unknown>("", 0, null, undefined, false, Number.NaN),
);

/** The two Chunk_Load_Error failure modes from the design. */
const failureModeArb = fc.constantFrom(
  "import-rejects",
  "throws-during-render",
);

/**
 * Sentinel feature text that must NEVER appear in the DOM after a failure.
 * Prefixed so it cannot collide with Chunk_Error_View copy.
 */
const sentinelArb = fc
  .stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ),
    { minLength: 1, maxLength: 24 },
  )
  .map((s) => `feature-sentinel-${s}`);

describe("Property 5: failure lifecycle", () => {
  beforeEach(() => {
    // React logs errors caught by error boundaries via console.error;
    // suppress to keep the property-run output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "any load failure yields the Chunk_Error_View with no fallback, no partial feature content, and the route unchanged",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          errorValueArb,
          failureModeArb,
          sentinelArb,
          async (errorValue, failureMode, sentinel) => {
            // Loader spy stands in for the dynamic import of a Feature_Chunk.
            const loader = vi.fn(
              (): Promise<{ default: ComponentType }> =>
                failureMode === "import-rejects"
                  ? Promise.reject(errorValue)
                  : Promise.resolve({
                      // Module resolves to a component whose initial render
                      // throws AFTER emitting sentinel content, so a
                      // non-atomic commit would leak the sentinel.
                      default: function ThrowingFeature() {
                        return (
                          <div>
                            <span>{sentinel}</span>
                            <Thrower error={errorValue} />
                          </div>
                        );
                      },
                    }),
            );
            const LazyRoute = createLazyRoute(loader);

            try {
              render(
                <MemoryRouter initialEntries={[ROUTE_PATH]}>
                  <LocationProbe />
                  <Routes>
                    <Route path={ROUTE_PATH} element={<LazyRoute />} />
                  </Routes>
                </MemoryRouter>,
              );

              // Chunk_Error_View replaces the failed load.
              await screen.findByText("Feature failed to load");

              // Retry affordance is present.
              expect(
                screen.getByRole("button", { name: "Retry" }),
              ).toBeTruthy();

              // The Suspense_Fallback is gone (spinner has role="status").
              expect(screen.queryByRole("status")).toBeNull();

              // No partial Feature_Module content leaked into the DOM.
              expect(document.body.textContent ?? "").not.toContain(sentinel);

              // The application remains on the current route.
              expect(screen.getByTestId("location-probe").textContent).toBe(
                ROUTE_PATH,
              );

              // Exactly one dynamic import execution for this attempt.
              expect(loader).toHaveBeenCalledTimes(1);
            } finally {
              cleanup();
            }
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});
