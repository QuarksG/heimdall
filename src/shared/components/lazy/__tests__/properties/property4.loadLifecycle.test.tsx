// Feature: feature-code-splitting, Property 4: Load lifecycle — fallback while pending, module UI on resolve
//
// For any Feature_Module whose granted navigation leaves the import pending,
// the Suspense_Fallback is displayed in the route content area; when the
// import resolves, the Feature_Module UI replaces the fallback.
//
// Harness: the loader is a vi.fn() spy returning a deferred promise under
// test control, passed directly to createLazyRoute (the FeatureGate stack is
// exercised separately in the gate-integration tests). A loader invocation is
// the observable proxy for a Feature_Chunk request.
//
// **Validates: Requirements 2.9, 3.1, 3.2**

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { createLazyRoute } from "../../createLazyRoute";

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const idChars = "abcdefghijklmnopqrstuvwxyz0123456789";
const textChars = `${idChars}ABCDEFGHIJKLMNOPQRSTUVWXYZ -_.,`;

/** URL/DOM-safe testid for the sentinel Feature_Module component. */
const testIdArb = fc
  .array(fc.constantFrom(...idChars), { minLength: 1, maxLength: 16 })
  .map((cs) => `sentinel-${cs.join("")}`);

/** Arbitrary visible text rendered by the sentinel Feature_Module. */
const sentinelTextArb = fc
  .array(fc.constantFrom(...textChars), { minLength: 1, maxLength: 40 })
  .map((cs) => cs.join(""));

describe("Property 4: Load lifecycle — fallback while pending, module UI on resolve", () => {
  it("shows the Suspense_Fallback while the import is pending and replaces it with the module UI on resolve", async () => {
    await fc.assert(
      fc.asyncProperty(testIdArb, sentinelTextArb, async (testId, text) => {
        const load = deferred<{ default: ComponentType }>();
        const loader = vi.fn(() => load.promise);
        const LazyRoute = createLazyRoute(loader);
        const Sentinel = () => <div data-testid={testId}>{text}</div>;

        try {
          render(<LazyRoute />);

          // Rendering the lazy route executes the import exactly once.
          expect(loader).toHaveBeenCalledTimes(1);

          // While the import is pending, the Suspense_Fallback (spinner with
          // role="status" and hidden label) occupies the route content area
          // and no Feature_Module UI is present. (Req 2.9, 3.1)
          expect(screen.getByRole("status")).toBeTruthy();
          expect(screen.getByText("Loading feature…")).toBeTruthy();
          expect(screen.queryByTestId(testId)).toBeNull();

          // Resolve the import with the sentinel Feature_Module.
          await act(async () => {
            load.resolve({ default: Sentinel });
          });

          // The Feature_Module UI replaces the fallback. (Req 3.2)
          await waitFor(() => {
            expect(screen.getByTestId(testId)).toBeTruthy();
          });
          expect(screen.getByTestId(testId).textContent).toBe(text);
          expect(screen.queryByRole("status")).toBeNull();

          // The single import execution was sufficient — no re-invocation.
          expect(loader).toHaveBeenCalledTimes(1);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
