// Feature: feature-code-splitting, Property 8: Revocation beats the cached module
//
// For any Feature_Module that has been successfully loaded and rendered
// during the session, if the entitlement is then revoked, the next
// navigation to that route renders the Access_Denied_View and does not
// render the Feature_Module — even though its chunk is already in memory.
//
// Harness: the shared lazyRouteHarness renders the real FeatureGate /
// usePermissions / ProtectedRoute stack over a mocked AuthContext whose
// value can change mid-test (live entitlement update). The feature module
// is first loaded and rendered (its loader spy resolves, so the "chunk" is
// cached in memory), then the entitlement is revoked via setAuth and the
// route is re-entered.
//
// NOTE: this import must stay FIRST — the harness registers the
// AuthContext module mock before the real gate stack is imported.
//
// **Validates: Requirements 2.8**

import {
  renderApp,
  arbFeatureKey,
  FEATURE_ROUTES,
  FEATURE_TO_ENTITLEMENT,
  ENTITLEMENT_KEYS,
  featureUiTestId,
  unlocks,
  type GatedFeatureKey,
  type HarnessAuth,
} from "../lazyRouteHarness";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cleanup, screen, waitFor } from "@testing-library/react";

/** Extra entitlement keys kept in the session as noise; the revocation is
 *  the removal of the feature's own key (or the Admin role for Settings). */
const arbExtraEntitlements: fc.Arbitrary<string[]> = fc.subarray([
  ...ENTITLEMENT_KEYS,
]);

/** Auth state that unlocks `feature`: Admin for the role-gated Settings
 *  panel, otherwise Staff holding the feature's mapped entitlement key. */
function unlockingAuth(
  feature: GatedFeatureKey,
  extras: readonly string[],
): HarnessAuth {
  if (feature === "Settings") {
    return { role: "Admin", allowedFeatures: [...extras] };
  }
  const key = FEATURE_TO_ENTITLEMENT[feature]!;
  return { role: "Staff", allowedFeatures: [...new Set([key, ...extras])] };
}

/** Auth state after revocation: Staff (Admin role dropped for Settings)
 *  with the feature's mapped entitlement key removed from allowedFeatures. */
function revokedAuth(
  feature: GatedFeatureKey,
  extras: readonly string[],
): HarnessAuth {
  const key = FEATURE_TO_ENTITLEMENT[feature];
  return {
    role: "Staff",
    allowedFeatures: extras.filter((e) => e !== key),
  };
}

describe("Property 8: Revocation beats the cached module", () => {
  it("renders the Access_Denied_View, not the cached Feature_Module, on the next navigation after revocation", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbFeatureKey,
        arbExtraEntitlements,
        async (feature, extras) => {
          const granted = unlockingAuth(feature, extras);
          const revoked = revokedAuth(feature, extras);
          // Sanity: the generated states sit on the right side of the gate.
          expect(unlocks(feature, granted)).toBe(true);
          expect(unlocks(feature, revoked)).toBe(false);

          const app = renderApp({ initialEntries: ["/"], auth: granted });
          try {
            // Load and render the Feature_Module (chunk now in memory).
            app.navigate(FEATURE_ROUTES[feature]);
            await waitFor(() => {
              expect(screen.getByTestId(featureUiTestId(feature))).toBeTruthy();
            });
            expect(app.loaderCallCounts()[feature]).toBe(1);

            // Navigate away, then revoke the entitlement mid-session.
            app.navigate("/");
            app.setAuth(revoked);

            // Next navigation to the route: Access_Denied_View, no module.
            app.navigate(FEATURE_ROUTES[feature]);
            expect(app.location().pathname).toBe(FEATURE_ROUTES[feature]);

            // The exact Access_Denied_View copy from FeatureGate. (Req 2.8)
            expect(
              screen.getByRole("heading", { name: "Access Denied" }),
            ).toBeTruthy();
            if (feature === "Settings") {
              // Settings renders the admin-restricted denial branch.
              expect(
                screen.getByText(/This page is restricted to/),
              ).toBeTruthy();
            } else {
              expect(
                screen.getByText(/You don't have permission to access/),
              ).toBeTruthy();
            }

            // The Feature_Module UI is NOT rendered, even though its module
            // was already loaded earlier in the session.
            expect(screen.queryByTestId(featureUiTestId(feature))).toBeNull();

            // The denied gate mounted no lazy boundary — the loader count
            // is unchanged from the single granted load.
            expect(app.loaderCallCounts()[feature]).toBe(1);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 runs × full app render (real gate stack + layout) needs more than
    // the default 5s test timeout.
  }, 120_000);
});
