// Feature: feature-code-splitting, Property 1: A denying gate never triggers an import and always renders the exact Access_Denied_View
//
// For any Feature_Module, any entitlement state (or role, for Settings) that
// does not unlock it, any number of navigation attempts to its route, and any
// chunk loader behavior (pending, rejecting, or previously resolved), every
// navigation renders the existing Access_Denied_View with its exact pre-split
// text, and the feature's import loader is never invoked.
//
// Harness: the real FeatureGate/usePermissions/ProtectedRoute stack renders
// over a mocked AuthContext value; per-feature vi.fn() loader spies injected
// through createLazyRoute are the observable proxy for Feature_Chunk network
// requests. The harness MUST be imported before anything that transitively
// imports AuthContext.
//
// **Validates: Requirements 2.1, 2.3, 2.4, 4.2, 5.3**

import {
  renderApp,
  arbFeatureKey,
  arbEntitlementSubset,
  unlocks,
  FEATURE_ROUTES,
  FEATURE_TO_ENTITLEMENT,
  createDeferredModule,
  stubModule,
  featureUiTestId,
} from "../lazyRouteHarness";
import type { FeatureLoader, GatedFeatureKey } from "../lazyRouteHarness";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cleanup, screen } from "@testing-library/react";

/** Exact pre-split Access_Denied_View paragraph text rendered by the real
 *  FeatureGate (src/features/authentication/guards/FeatureGate.tsx). */
function expectedDeniedText(feature: GatedFeatureKey): string {
  if (feature === "Settings") {
    return (
      "This page is restricted to administrators. " +
      "If you believe you should have admin access, contact the admin team."
    );
  }
  return (
    `You don't have permission to access ${feature}. ` +
    "Please submit an Access Request from the sidebar and wait for admin approval."
  );
}

/** The three generated chunk-loader behaviors. None of them should ever be
 *  observed, because a denying gate must never invoke the loader. */
type LoaderBehavior = "pending" | "rejecting" | "resolved";

function makeLoaderImpl(
  behavior: LoaderBehavior,
  feature: GatedFeatureKey,
): FeatureLoader {
  switch (behavior) {
    case "pending":
      // Import hangs forever if it were (incorrectly) triggered.
      return () => createDeferredModule().promise;
    case "rejecting": {
      // Import fails immediately (rejection handler pre-attached by the
      // harness so an unused rejected promise never surfaces as unhandled).
      return () => {
        const deferred = createDeferredModule();
        deferred.reject(new Error("simulated Chunk_Load_Error"));
        return deferred.promise;
      };
    }
    case "resolved":
      // Import would resolve instantly (previously-resolved module case).
      return () => Promise.resolve(stubModule(feature));
  }
}

/** A feature plus an entitlement state that does NOT unlock it: role Staff
 *  (Admin unlocks everything), and the feature's own entitlement key removed
 *  from the generated allowedFeatures subset. For Settings (role-gated,
 *  Admin-only) any Staff session with any entitlement subset denies. */
const arbDenyingCase = arbFeatureKey.chain((feature) =>
  fc.record({
    feature: fc.constant(feature),
    allowedFeatures: arbEntitlementSubset.map((subset) =>
      subset.filter((key) => key !== FEATURE_TO_ENTITLEMENT[feature]),
    ),
  }),
);

describe("Property 1: A denying gate never triggers an import and always renders the exact Access_Denied_View", () => {
  it("renders the exact Access_Denied_View and never invokes the feature's loader, for any denying auth state, attempt count, and loader behavior", () => {
    fc.assert(
      fc.property(
        arbDenyingCase,
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom<LoaderBehavior>("pending", "rejecting", "resolved"),
        ({ feature, allowedFeatures }, attempts, behavior) => {
          // Defensive guard: the generated auth state must not unlock the
          // feature (mirrors the real usePermissions decision).
          fc.pre(!unlocks(feature, { role: "Staff", allowedFeatures }));

          const route = FEATURE_ROUTES[feature];

          try {
            const harness = renderApp({
              initialEntries: [route],
              auth: { authenticated: true, role: "Staff", allowedFeatures },
              loaderImpls: { [feature]: makeLoaderImpl(behavior, feature) },
            });

            const assertDenied = () => {
              // The session stays on the feature route (denial is a view,
              // not a redirect).
              expect(harness.location().pathname).toBe(route);

              // Exact pre-split Access_Denied_View content. (Req 5.3)
              const heading = screen.getByRole("heading", {
                name: "Access Denied",
              });
              const paragraph = heading.parentElement?.querySelector("p");
              expect(paragraph?.textContent).toBe(expectedDeniedText(feature));

              // No Feature_Module UI and no Suspense_Fallback — the lazy
              // child never rendered. (Req 2.1, 2.3)
              expect(screen.queryByTestId(featureUiTestId(feature))).toBeNull();
              expect(screen.queryByRole("status")).toBeNull();

              // Zero import invocations for this feature. (Req 2.3, 2.4, 4.2)
              expect(harness.loaderCallCounts()[feature]).toBe(0);
            };

            // Attempt 1: direct entry at the feature route.
            assertDenied();

            // Further attempts: navigate away and back (route remount),
            // still denied with zero loader calls every time. (Req 2.4)
            for (let attempt = 1; attempt < attempts; attempt++) {
              harness.navigate("/");
              harness.navigate(route);
              assertDenied();
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
