// Feature: feature-code-splitting, Property 7: Re-entering a route after a failure starts a fresh load, not a persisted error view
//
// For any Feature_Module whose route previously ended in a Chunk_Load_Error
// (after any number of in-route retry attempts that all failed), navigating
// away and then re-entering the route invokes the loader again and displays
// the Suspense_Fallback — never the stale Chunk_Error_View. Navigation
// away/re-entry is simulated by unmounting and remounting the LazyRoute
// component: unmount discards all boundary state, so re-entry starts at
// attempt 0 with a fresh React.lazy instance.
//
// **Validates: Requirements 3.10**

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

describe("Property 7: route re-entry after a failure starts a fresh load", () => {
  it(
    "re-entering a failed route re-invokes the loader and shows the fallback, never the stale error view",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Number of consecutive failures (initial load + retries) the
          // route suffers before the user navigates away: the re-entry
          // guarantee must hold regardless of how deep the attempt counter
          // went before unmount.
          fc.integer({ min: 1, max: 3 }),
          // Number of leave/re-enter cycles: every re-entry must start
          // fresh, not only the first one.
          fc.integer({ min: 1, max: 2 }),
          async (failuresBeforeLeaving, reentryCycles) => {
            const deferreds: Deferred[] = [];
            const loader = vi.fn(() => {
              const d = createDeferred();
              deferreds.push(d);
              return d.promise;
            });

            const LazyRoute = createLazyRoute(loader);
            const user = userEvent.setup({ delay: null });

            try {
              for (let cycle = 0; cycle < reentryCycles; cycle++) {
                const callsBeforeMount = loader.mock.calls.length;

                // Enter the route (initial mount or re-entry after a prior
                // Chunk_Load_Error). Mounting must invoke the loader afresh
                // and display the Suspense_Fallback — never a persisted
                // Chunk_Error_View from the previous visit.
                const { unmount } = render(<LazyRoute />);

                expect(loader).toHaveBeenCalledTimes(callsBeforeMount + 1);
                expect(fallbackIsShown()).toBe(true);
                expect(errorViewIsShown()).toBe(false);

                // Drive the route into a Chunk_Load_Error, exercising the
                // in-route retry path between failures so the attempt
                // counter is non-trivial before the user navigates away.
                for (let f = 1; f <= failuresBeforeLeaving; f++) {
                  await act(async () => {
                    deferreds[deferreds.length - 1].reject(
                      new Error(`chunk load failure ${f} (cycle ${cycle})`),
                    );
                    await Promise.resolve();
                  });
                  await screen.findByText("Feature failed to load");
                  expect(fallbackIsShown()).toBe(false);

                  if (f < failuresBeforeLeaving) {
                    await user.click(retryButton());
                    expect(fallbackIsShown()).toBe(true);
                  }
                }

                // The route ends this visit in the Chunk_Error_View.
                expect(errorViewIsShown()).toBe(true);

                // Navigate away: unmounting the route discards the attempt
                // counter and boundary error state.
                unmount();
              }

              // One final re-entry: even after every prior visit ended in a
              // Chunk_Load_Error, the route starts a fresh load.
              const callsBeforeReentry = loader.mock.calls.length;
              render(<LazyRoute />);

              expect(loader).toHaveBeenCalledTimes(callsBeforeReentry + 1);
              expect(fallbackIsShown()).toBe(true);
              expect(errorViewIsShown()).toBe(false);
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
