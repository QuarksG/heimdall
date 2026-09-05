// Feature: feature-code-splitting, Property 2: A granting gate triggers the import exactly on the first granted navigation
//
// For any Feature_Module and any sequence of entitlement states ending in a
// state that unlocks it (including sequences that begin locked — the
// mid-session grant case), the import loader is invoked for the first time
// only on the first navigation that occurs while the gate grants (never
// earlier, with no full page reload), and the resolved Feature_Module UI
// renders.
//
// Harness notes: per-feature vi.fn() loader spies are the observable proxy
// for Feature_Chunk requests; entitlement state changes go through setAuth
// (a live mocked-AuthContext update, exactly like a mid-session grant per the
// granular-feature-entitlements spec); all navigation goes through the
// harness's MemoryRouter navigate(), so no full page reload can occur by
// construction.
//
// **Validates: Requirements 1.6, 2.2, 2.5**

// IMPORTANT: the harness must be imported BEFORE anything that (transitively)
// imports features/authentication/context/AuthContext, so its module mock
// registers first.
import {
  renderApp,
  arbFeatureKey,
  arbEntitlementSubset,
  unlocks,
  FEATURE_ROUTES,
  FEATURE_TO_ENTITLEMENT,
  featureUiTestId,
} from "../lazyRouteHarness";
import type { GatedFeatureKey, HarnessAuth } from "../lazyRouteHarness";

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cleanup } from "@testing-library/react";

/** An auth state that unlocks `feature` (Settings is Admin-role-gated;
 *  everything else needs its mapped entitlement key in allowedFeatures).
 *  `noise` entitlements are kept to vary the surrounding state. */
function grantingAuth(feature: GatedFeatureKey, noise: string[]): HarnessAuth {
  const key = FEATURE_TO_ENTITLEMENT[feature];
  if (key === null) {
    // Settings: role-gated, entitlements irrelevant
    return { role: "Admin", allowedFeatures: noise };
  }
  return {
    role: "Staff",
    allowedFeatures: [...new Set([...noise, key])],
  };
}

/** An auth state that does NOT unlock `feature`: Staff role, with the
 *  feature's entitlement key stripped from the noise subset. */
function lockedAuth(feature: GatedFeatureKey, noise: string[]): HarnessAuth {
  const key = FEATURE_TO_ENTITLEMENT[feature];
  return {
    role: "Staff",
    allowedFeatures: noise.filter((f) => f !== key),
  };
}

/** A sequence of entitlement-state steps ending in one that unlocks the
 *  feature. The prefix steps are freely locked or granting, so sequences
 *  that begin locked (mid-session grant) and sequences that grant on the
 *  very first navigation are both generated. */
const arbStatePlan = fc
  .array(fc.record({ unlock: fc.boolean(), noise: arbEntitlementSubset }), {
    maxLength: 4,
  })
  .chain((prefix) =>
    arbEntitlementSubset.map((finalNoise) => [
      ...prefix,
      { unlock: true, noise: finalNoise },
    ]),
  );

describe("Property 2: A granting gate triggers the import exactly on the first granted navigation", () => {
  // 100 property runs each render the real ProtectedRoute/MainLayout/
  // FeatureGate stack, so this test needs more than the 5s default budget.
  it("keeps the loader at zero through every locked navigation, invokes it exactly once on the first granted navigation, and renders the resolved feature UI", { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(arbFeatureKey, arbStatePlan, async (feature, plan) => {
        const route = FEATURE_ROUTES[feature];
        const states = plan.map(({ unlock, noise }) =>
          unlock ? grantingAuth(feature, noise) : lockedAuth(feature, noise),
        );

        // Sanity: each built state agrees with the real gate semantics.
        states.forEach((auth, i) => {
          expect(unlocks(feature, auth)).toBe(plan[i].unlock);
        });

        const handle = renderApp({
          initialEntries: ["/"],
          auth: states[0],
        });
        try {
          // Never earlier: entry render on the Home route triggers nothing.
          expect(handle.loaderCallCounts()[feature]).toBe(0);

          for (let i = 0; i < states.length; i++) {
            if (i > 0) {
              // Mid-session live entitlement update via setAuth — no full
              // page reload (Req 2.5). Applied while away from the feature
              // route; the grant alone must not trigger the import.
              handle.setAuth(states[i]);
              expect(handle.loaderCallCounts()[feature]).toBe(0);
            }

            handle.navigate(route);

            if (!plan[i].unlock) {
              // Locked navigation: the gate denies, the import never
              // executes (never earlier than the first grant).
              expect(handle.loaderCallCounts()[feature]).toBe(0);
              // Interleave: navigate away before the next state transition.
              handle.navigate("/");
              expect(handle.loaderCallCounts()[feature]).toBe(0);
            } else {
              // First navigation under a granting state: the import executes
              // exactly once, only now (Req 1.6, 2.2).
              expect(handle.loaderCallCounts()[feature]).toBe(1);
              expect(handle.location().pathname).toBe(route);

              // The resolved Feature_Module UI renders (Req 1.6).
              const ui = await handle.findByTestId(featureUiTestId(feature));
              expect(ui).toBeTruthy();

              // Rendering the resolved module did not re-invoke the import.
              expect(handle.loaderCallCounts()[feature]).toBe(1);
              break; // first granted navigation reached — property asserted
            }
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
