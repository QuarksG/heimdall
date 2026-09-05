// Feature: feature-code-splitting, Property 9: Deep links preserve the URL byte-for-byte
//
// For any Feature_Module route and any query string and hash fragment, an
// entitled session entering the router directly at that deep link renders the
// Feature_Module after the chunk load completes, and the location's pathname,
// search, and hash are identical to the requested values.
//
// Harness: real FeatureGate/ProtectedRoute stack over a mocked AuthContext
// value (src/__tests__/lazyRouteHarness.tsx); the deep link is fed to the
// router as the initial history entry, exactly like a direct URL open.
//
// **Validates: Requirements 5.2**

// The harness must be imported before anything that transitively imports
// AuthContext so its module mock registers first.
import {
  renderApp,
  arbFeatureKey,
  arbQueryString,
  arbHashString,
  FEATURE_ROUTES,
  FEATURE_TO_ENTITLEMENT,
  featureUiTestId,
} from "../lazyRouteHarness";
import type { HarnessAuth, GatedFeatureKey } from "../lazyRouteHarness";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cleanup } from "@testing-library/react";

/** Minimal auth state that entitles the session to `key`.
 *  Settings is role-gated (Admin only); the rest are entitlement-gated. */
function entitledAuthFor(key: GatedFeatureKey): HarnessAuth {
  const entitlement = FEATURE_TO_ENTITLEMENT[key];
  return entitlement === null
    ? { role: "Admin" }
    : { role: "Staff", allowedFeatures: [entitlement] };
}

describe("Property 9: Deep links preserve the URL byte-for-byte", () => {
  it("renders the Feature_Module at the deep link and keeps pathname, search, and hash identical to the requested values", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbFeatureKey,
        arbQueryString,
        arbHashString,
        async (key, query, hash) => {
          const deepLink = `${FEATURE_ROUTES[key]}${query}${hash}`;
          const handle = renderApp({
            initialEntries: [deepLink],
            auth: entitledAuthFor(key),
          });

          try {
            // The Feature_Module UI appears once the chunk load completes.
            await handle.findByTestId(featureUiTestId(key));

            // Byte-for-byte URL preservation. (Req 5.2)
            const location = handle.location();
            expect(location.pathname).toBe(FEATURE_ROUTES[key]);
            expect(location.search).toBe(query);
            expect(location.hash).toBe(hash);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 runs × a full app-shell mount each needs more than the 5s default.
  }, 120_000);
});
