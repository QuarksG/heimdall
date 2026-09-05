// Feature: feature-code-splitting, Property 6: Retry re-executes the import; the reload control appears from the second failure onward
//
// For any count k in [1..5] of consecutive load failures: activating retry
// after each failure replaces the Chunk_Error_View with the Suspense_Fallback
// and increments the loader invocation count by one (a fresh dynamic import
// execution, not the cached rejection); the Chunk_Error_View shown after the
// first failure offers Retry WITHOUT the reload control, and the view shown
// after every subsequent failure (failureIndex >= 2) offers BOTH Retry and
// the reload control.
//
// **Validates: Requirements 3.4, 3.5**

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";
import type { ComponentType } from "react";
import { createLazyRoute } from "../../createLazyRoute";

// React logs boundary-caught errors via console.error; suppress that noise
// so 100 property runs do not flood the test output.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

/** A loader promise whose rejection the test controls. */
type Deferred = {
  promise: Promise<{ default: ComponentType }>;
  reject: (reason: unknown) => void;
};

function createDeferred(): Deferred {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ default: ComponentType }>((_, rej) => {
    reject = rej;
  });
  // Register a handler up front so the rejection never surfaces as an
  // unhandled promise rejection (React.lazy attaches its own handlers,
  // but only once the lazy component actually renders).
  promise.catch(() => {});
  return { promise, reject };
}

const fallbackIsShown = () =>
  screen.queryByRole("status") !== null &&
  screen.queryByText("Loading feature…") !== null;

const errorViewIsShown = () =>
  screen.queryByText("Feature failed to load") !== null;

const retryButton = () => screen.getByRole("button", { name: "Retry" });

const queryReloadButton = () =>
  screen.queryByRole("button", { name: "Reload page" });

describe("Property 6: retry semantics of the lazy boundary", () => {
  it(
    "retry re-executes the import once per activation; reload control appears iff failureIndex >= 2",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (k) => {
          const deferreds: Deferred[] = [];
          const loader = vi.fn(() => {
            const d = createDeferred();
            deferreds.push(d);
            return d.promise;
          });

          const LazyRoute = createLazyRoute(loader);
          const user = userEvent.setup({ delay: null });

          try {
            render(<LazyRoute />);

            // Initial render triggers the first loader invocation and shows
            // the Suspense_Fallback while the import is pending.
            expect(loader).toHaveBeenCalledTimes(1);
            expect(fallbackIsShown()).toBe(true);
            expect(errorViewIsShown()).toBe(false);

            for (let failureIndex = 1; failureIndex <= k; failureIndex++) {
              // Fail the current (pending) load attempt.
              await act(async () => {
                deferreds[failureIndex - 1].reject(
                  new Error(`chunk load failure ${failureIndex}`),
                );
                await Promise.resolve();
              });
              await screen.findByText("Feature failed to load");

              // Chunk_Error_View replaced the fallback; Retry is always
              // offered; the reload control appears iff this failure was
              // itself a retry (failureIndex >= 2).
              expect(fallbackIsShown()).toBe(false);
              expect(retryButton()).toBeTruthy();
              if (failureIndex >= 2) {
                expect(queryReloadButton()).not.toBeNull();
              } else {
                expect(queryReloadButton()).toBeNull();
              }

              // Loader invocations observed so far equal failures observed.
              expect(loader).toHaveBeenCalledTimes(failureIndex);

              // Activate retry after every failure except the last one, so
              // exactly k failures occur in total.
              if (failureIndex < k) {
                await user.click(retryButton());

                // Retry replaces the Chunk_Error_View with the
                // Suspense_Fallback and invokes the loader afresh (a new
                // dynamic import execution, not the cached rejection).
                expect(errorViewIsShown()).toBe(false);
                expect(fallbackIsShown()).toBe(true);
                expect(loader).toHaveBeenCalledTimes(failureIndex + 1);
              }
            }

            // Total loader invocations equal the total failures observed.
            expect(loader).toHaveBeenCalledTimes(k);
            expect(deferreds).toHaveLength(k);
          } finally {
            cleanup();
          }
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});
