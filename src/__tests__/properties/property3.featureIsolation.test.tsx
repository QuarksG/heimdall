// Feature: feature-code-splitting, Property 3: Loading one feature never invokes another feature's loader
//
// For any Feature_Module navigated to by an entitled session, that feature's
// loader is invoked and the loaders of all other Feature_Modules have zero
// invocations.
//
// Harness: the real FeatureGate/usePermissions/ProtectedRoute stack renders
// over a mocked AuthContext value; per-feature vi.fn() loader spies injected
// through createLazyRoute are the observable proxy for Feature_Chunk requests.
//
// **Validates: Requirements 1.7**

// The harness MUST be imported before anything that transitively imports
// AuthContext so its module mock registers first.
import {
  renderApp,
  arbFeatureKey,
  arbEntitlementSubset,
  FEATURE_ROUTES,
  FEATURE_TO_ENTITLEMENT,
  GATED_FEATURE_KEYS,
  featureUiTestId,
  unlocks,
} from "../lazyRouteHarness";
import type { HarnessAuth } from "../lazyRouteHarness";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cleanup, screen } from "@testing-library/react";

describe("Property 3: Loading one feature never invokes another feature's loader", () => {
  it("invokes exactly the target feature's loader once and no other feature's loader", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbFeatureKey,
        // Extra entitlements the session may also hold — isolation must hold
        // even when the session is entitled to several other features.
        arbEntitlementSubset,
        // Whether to unlock via the Admin role (unlocks everything) or via
        // the feature's mapped backend entitlement key.
        fc.boolean(),
        async (feature, extraEntitlements, viaAdmin) => {
          // Settings is role-gated (Admin only); it has no entitlement key.
          const entitlementKey = FEATURE_TO_ENTITLEMENT[feature];
          const useAdmin = viaAdmin || entitlementKey === null;
          const auth: HarnessAuth = {
            role: useAdmin ? "Admin" : "Staff",
            allowedFeatures: useAdmin
              ? extraEntitlements
              : [...new Set([...extraEntitlements, entitlementKey!])],
          };
          // Sanity: the generated auth state must unlock the target feature.
          expect(unlocks(feature, auth)).toBe(true);

          const app = renderApp({ initialEntries: ["/"], auth });
          try {
            app.navigate(FEATURE_ROUTES[feature]);

            // The granted navigation loads and renders the feature UI.
            await screen.findByTestId(featureUiTestId(feature));

            // Exactly one invocation for the target feature's loader and
            // zero for every other Feature_Module's loader. (Req 1.7)
            const counts = app.loaderCallCounts();
            for (const key of GATED_FEATURE_KEYS) {
              expect(counts[key]).toBe(key === feature ? 1 : 0);
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
